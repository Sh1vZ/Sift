<script setup lang="ts">
import { now, settings, updateSettings } from '@/composables/useLibrary'
import { processingUploads, stageText } from '@/composables/useUploads'
import {
  accounts,
  addAccount,
  addAccountJson,
  availableAccounts,
  cancelConnect,
  connectAccount,
  connectedAccounts,
  disconnectAccount,
  importAccountFiles,
  isBusy,
  isExhausted,
  openExternalUrl,
  openQuotaPage,
  removeAccount,
  renameAccount,
  youtube,
} from '@/composables/useYouTube'
import {
  GOOGLE_CONSOLE_CONSENT_URL,
  GOOGLE_CONSOLE_CREDENTIALS_URL,
  GOOGLE_CONSOLE_URL,
  GOOGLE_CONSOLE_YOUTUBE_API_URL,
  QUOTA_COST,
  QUOTA_UNITS_PER_DAY,
  YOUTUBE_AUDIT_FORM_URL,
  formatUntil,
  type YouTubeAccount,
} from '@shared/youtube'
import { computed, ref } from 'vue'
import SettingsPanel from './SettingsPanel.vue'
import SettingsRow from './SettingsRow.vue'

const units = new Intl.NumberFormat()
const CLIENT_SECRET_MAX_BYTES = 64 * 1024

const showGuide = ref(false)
const guideOpen = computed(() => accounts.value.length === 0 || showGuide.value)

/**
 * Names the cost outright. The user asked for no quota counting anywhere in
 * Sift, so the honest thing is to say what a check is worth and let them judge.
 */
const checkDescription = computed(() =>
  [
    `Ask YouTube how an uploaded video is doing until it is ready — one unit a check against the ${QUOTA_UNITS_PER_DAY.toLocaleString()} a day, batched across videos, against ${QUOTA_COST.videosInsert.toLocaleString()} for the upload itself.`,
    'Sift asks more often at first, then every few minutes, and stops after two hours; Check now asks again after that.',
  ].join(' '),
)

const processingLine = computed(() =>
  processingUploads.value.map((j) => `${j.title} · ${stageText(j)}`).join(' — '),
)

const summary = computed(() => {
  const n = accounts.value.length
  const c = connectedAccounts.value.length
  if (!n) return 'Add a Google Cloud project to start uploading.'
  const parked = c - availableAccounts.value.length
  const parts = [`${c} of ${n} connected`]
  if (parked) parts.push(`${parked} out of quota until midnight Pacific`)
  return parts.join(' · ') + '.'
})

// -------------------------------------------------------------- add project

const over = ref(false)
const pasting = ref(false)
const pasteClientId = ref('')
const pasteSecret = ref('')
const pasteLabel = ref('')
const adding = ref(false)

async function onDrop(e: DragEvent): Promise<void> {
  over.value = false
  const files = [...(e.dataTransfer?.files ?? [])]
  if (!files.length) return
  for (const f of files) {
    if (f.size > CLIENT_SECRET_MAX_BYTES) continue
    await addAccountJson(await f.text())
  }
}

async function addPasted(): Promise<void> {
  adding.value = true
  try {
    const ok = await addAccount(pasteClientId.value, pasteSecret.value, pasteLabel.value)
    if (ok) {
      pasteClientId.value = ''
      pasteSecret.value = ''
      pasteLabel.value = ''
      pasting.value = false
    }
  } finally {
    adding.value = false
  }
}

// ---------------------------------------------------------------- per row

const connecting = (a: YouTubeAccount): boolean => a.connection === 'connecting'

function statusLine(a: YouTubeAccount): string {
  if (a.error) return a.error
  if (a.connection === 'connected') {
    const who = a.channel?.title ?? 'Connected'
    return isExhausted(a)
      ? `${who} · YouTube reported the daily quota spent; uploads resume in ${formatUntil(a.quotaExhaustedUntilMs, now.value)}`
      : who
  }
  if (a.connection === 'connecting') return 'Finish signing in in your browser…'
  if (!a.hasSecret) return 'Client secret missing — re-import the JSON.'
  return a.channel?.title ? `Not connected · was ${a.channel.title}` : 'Not connected'
}

function connectLabel(a: YouTubeAccount): string {
  return a.channel || a.error ? 'Reconnect' : 'Connect YouTube'
}

function menuItems(a: YouTubeAccount) {
  return [
    [
      { label: 'Rename', icon: 'i-lucide-pencil', onSelect: () => void renameAccount(a) },
      {
        label: 'Quota usage in Google Cloud',
        icon: 'i-lucide-gauge',
        onSelect: () => openQuotaPage(a),
      },
    ],
    [
      {
        label: 'Remove project',
        icon: 'i-lucide-trash-2',
        color: 'error' as const,
        onSelect: () => void removeAccount(a),
      },
    ],
  ]
}

const initials = (label: string): string =>
  label
    .split(/[\s-_]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('')
</script>

<template>
  <div class="stack">
    <SettingsPanel title="Your projects" :description="summary" flush>
      <SettingsRow
        v-if="!youtube.encryptionAvailable && accounts.length"
        icon="lock"
        tone="warning"
        title="Sign-ins are not saved on this PC"
        description="Windows is not offering Sift a way to encrypt them, so every project needs connecting again after a restart."
      />

      <SettingsRow v-for="a in accounts" :key="a.id" icon="youtube" :title="a.label" tag="li">
        <template #title>
          <div class="acct-head">
            <UAvatar
              :src="a.channel?.avatar || undefined"
              :alt="a.channel?.title ?? a.label"
              :text="initials(a.label)"
              size="xs"
            />
            <span class="acct-label truncate">{{ a.label }}</span>
            <UBadge
              v-if="a.connection === 'connected'"
              color="success"
              variant="subtle"
              size="sm"
              label="Connected"
            />
            <UBadge
              v-else-if="a.connection === 'connecting'"
              color="primary"
              variant="subtle"
              size="sm"
              label="Waiting for the browser"
            />
            <UBadge v-else color="neutral" variant="subtle" size="sm" label="Not connected" />
            <UBadge
              v-if="isExhausted(a)"
              color="error"
              variant="subtle"
              size="sm"
              :label="`Out of quota · resets in ${formatUntil(a.quotaExhaustedUntilMs, now)}`"
            />
          </div>
        </template>

        <p class="acct-status" :class="{ 'is-error': a.error, 'is-parked': isExhausted(a) }">
          {{ statusLine(a) }}
        </p>

        <template #trailing>
          <UButton
            v-if="a.connection === 'connected'"
            label="Disconnect"
            color="error"
            variant="subtle"
            size="sm"
            :loading="isBusy(a.id)"
            @click="disconnectAccount(a)"
          />
          <template v-else-if="connecting(a)">
            <UButton
              label="Cancel"
              color="neutral"
              variant="subtle"
              size="sm"
              @click="cancelConnect()"
            />
          </template>
          <UButton
            v-else
            icon="i-lucide-youtube"
            :label="connectLabel(a)"
            color="primary"
            variant="soft"
            size="sm"
            :disabled="!a.hasSecret"
            @click="connectAccount(a.id)"
          />
          <UDropdownMenu :items="menuItems(a)" :ui="{ content: 'min-w-56' }">
            <UButton
              icon="i-lucide-ellipsis"
              color="neutral"
              variant="ghost"
              size="sm"
              square
              :loading="isBusy(a.id) && a.connection !== 'connected'"
              :disabled="isBusy(a.id)"
              aria-label="More actions"
            />
          </UDropdownMenu>
        </template>
      </SettingsRow>

      <UEmpty
        v-if="!accounts.length"
        class="empty"
        icon="i-lucide-youtube"
        title="No projects yet"
        description="Each Google Cloud project you add is its own daily upload budget."
      />
    </SettingsPanel>

    <SettingsPanel
      title="After the upload"
      description="Sending the file is only half of it — YouTube still has to process the video, and it can still refuse it."
      flush
    >
      <SettingsRow icon="radar" title="Check processing status" :description="checkDescription">
        <template #trailing>
          <USwitch
            :model-value="settings.youtubeCheckStatus"
            aria-label="Check processing status"
            @update:model-value="(v: boolean) => updateSettings({ youtubeCheckStatus: v })"
          />
        </template>
      </SettingsRow>
      <SettingsRow
        v-if="processingUploads.length"
        icon="loader"
        title="Being processed now"
        :description="processingLine"
      >
        <template #trailing>
          <UBadge
            color="primary"
            variant="soft"
            size="lg"
            :label="String(processingUploads.length)"
          />
        </template>
      </SettingsRow>
    </SettingsPanel>

    <SettingsPanel
      title="Add a project"
      description="Drop the client secret JSON downloaded from Google Cloud. Several at once is fine."
    >
      <div
        class="drop"
        :class="{ 'is-over': over }"
        @dragover.prevent="over = true"
        @dragleave="over = false"
        @drop.prevent="onDrop"
      >
        <UIcon name="i-lucide-file-json" class="drop-icon" />
        <p class="drop-title">Drop <span class="mono">client_secret_….json</span> here</p>
        <p class="drop-sub">or</p>
        <UButton
          icon="i-lucide-folder-open"
          label="Choose files…"
          color="primary"
          variant="soft"
          @click="importAccountFiles()"
        />
      </div>
      <UButton
        class="paste-toggle"
        :label="pasting ? 'Hide manual entry' : 'Paste the values instead'"
        color="neutral"
        variant="link"
        size="sm"
        :trailing-icon="pasting ? 'i-lucide-chevron-up' : 'i-lucide-chevron-down'"
        @click="pasting = !pasting"
      />
      <div v-if="pasting" class="paste">
        <UFormField label="Client ID">
          <UInput
            v-model="pasteClientId"
            placeholder="….apps.googleusercontent.com"
            class="mono w-full"
            spellcheck="false"
          />
        </UFormField>
        <UFormField label="Client secret" help="Saved encrypted and never shown again.">
          <UInput v-model="pasteSecret" type="password" class="w-full" spellcheck="false" />
        </UFormField>
        <UFormField label="Name">
          <UInput v-model="pasteLabel" placeholder="My project" class="w-full" />
        </UFormField>
        <UButton
          class="self-end"
          label="Add project"
          color="primary"
          variant="soft"
          :loading="adding"
          :disabled="!pasteClientId.trim() || !pasteSecret.trim()"
          @click="addPasted"
        />
      </div>
    </SettingsPanel>

    <SettingsPanel
      title="Set up a Google project"
      description="About five minutes on Google’s side, once per project."
    >
      <template #actions>
        <UButton
          v-if="accounts.length"
          :label="showGuide ? 'Hide the guide' : 'Show the guide'"
          color="neutral"
          variant="subtle"
          size="sm"
          @click="showGuide = !showGuide"
        />
      </template>
      <ol v-if="guideOpen" class="guide">
        <li>
          Open the
          <a :href="GOOGLE_CONSOLE_URL" target="_blank" rel="noreferrer">Google Cloud Console</a>
          and create a project. Any name works.
          <em
            >Every project is its own {{ units.format(QUOTA_UNITS_PER_DAY) }}-unit daily budget, so
            make several if you upload a lot.</em
          >
        </li>
        <li>
          Enable the
          <a :href="GOOGLE_CONSOLE_YOUTUBE_API_URL" target="_blank" rel="noreferrer"
            >YouTube Data API v3</a
          >.
        </li>
        <li>
          Open the
          <a :href="GOOGLE_CONSOLE_CONSENT_URL" target="_blank" rel="noreferrer"
            >OAuth consent screen</a
          >, choose External, fill in the app name and your email, then press
          <strong>Publish app</strong> so the status reads “In production”.
          <em>Left in Testing, Google expires the sign-in after 7 days.</em>
        </li>
        <li>
          Under
          <a :href="GOOGLE_CONSOLE_CREDENTIALS_URL" target="_blank" rel="noreferrer">Credentials</a
          >, create an <strong>OAuth client ID</strong> of type <strong>Desktop app</strong>.
        </li>
        <li>
          Press <strong>Download JSON</strong>, drop the file above, then press
          <strong>Connect YouTube</strong>. Your browser opens; sign in and allow. Google shows an
          “unverified app” warning for your own project — choose Continue.
        </li>
      </ol>
      <p v-else class="guide-hint">
        Hidden while you have projects. Open it again when adding another.
      </p>
    </SettingsPanel>

    <SettingsPanel
      title="Limits"
      description="What Google enforces, and how Sift deals with it."
      flush
    >
      <SettingsRow
        icon="shield-check"
        title="Unverified projects upload as private"
        description="Until Google audits a project, every video it uploads is locked to private no matter what you choose. Sift tells you when that happens."
      >
        <template #trailing>
          <UButton
            label="Audit form"
            color="neutral"
            variant="subtle"
            size="sm"
            trailing-icon="i-lucide-external-link"
            @click="openExternalUrl(YOUTUBE_AUDIT_FORM_URL)"
          />
        </template>
      </SettingsRow>
      <SettingsRow
        icon="hard-drive"
        title="What leaves this PC"
        description="Only the clip you choose and its title, description and tags, sent straight to Google when you press Upload. Nothing else, ever."
      />
    </SettingsPanel>
  </div>
</template>

<style scoped>
.acct-head {
  display: flex;
  align-items: center;
  gap: var(--s-2);
  min-width: 0;
  flex-wrap: wrap;
}
.acct-label {
  font-weight: 600;
  font-size: var(--text-md);
}
.acct-status {
  margin-top: 2px;
  font-size: var(--text-sm);
  color: var(--fg-muted);
  line-height: 1.45;
}
.acct-status.is-error,
.acct-status.is-parked {
  color: var(--warning);
}
.empty {
  padding: var(--s-6);
}
.drop {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--s-2);
  padding: var(--s-6);
  border-radius: var(--r-lg);
  border: 1px dashed var(--border-hover);
  background: var(--bg-2);
  text-align: center;
  transition:
    border-color var(--dur-fast) var(--ease-out),
    background var(--dur-fast) var(--ease-out);
}
.drop.is-over {
  border-color: var(--border-active);
  background: var(--primary-soft);
}
.drop-icon {
  width: 28px;
  height: 28px;
  color: var(--secondary);
}
.drop-title {
  font-weight: 600;
}
.drop-sub {
  font-size: var(--text-sm);
  color: var(--fg-dim);
}
.paste-toggle {
  margin-top: var(--s-3);
}
.paste {
  display: flex;
  flex-direction: column;
  gap: var(--s-3);
  margin-top: var(--s-3);
}
.guide {
  display: flex;
  flex-direction: column;
  gap: var(--s-3);
  padding-left: var(--s-5);
  font-size: var(--text-base);
  line-height: 1.55;
  color: var(--fg);
}
.guide li::marker {
  font-family: var(--font-heading);
  font-weight: 600;
  color: var(--secondary);
}
.guide a {
  color: var(--secondary);
  text-decoration: underline;
  text-decoration-color: color-mix(in srgb, var(--secondary) 45%, transparent);
  cursor: pointer;
}
.guide a:hover {
  color: var(--fg);
}
.guide em {
  display: block;
  margin-top: 2px;
  font-size: var(--text-sm);
  font-style: normal;
  color: var(--fg-muted);
}
.guide-hint {
  font-size: var(--text-sm);
  color: var(--fg-muted);
}
</style>
