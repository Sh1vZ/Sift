<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import {
  YOUTUBE_LIMITS,
  tagsLength,
  validateUploadRequest,
  type UploadRequest,
  type YouTubeAccount,
  type YouTubePlaylist,
  type YouTubePrivacy,
} from '@shared/youtube'
import { closeUploadDialog, startUpload, uploadDialog } from '@/composables/useUploads'
import {
  accountById,
  anyConnected,
  autoPick,
  connectedAccounts,
  createPlaylist,
  isExhausted,
  loadPlaylists,
  quotaResumesIn,
} from '@/composables/useYouTube'
import { closePlayer } from '@/composables/usePlayer'
import { openSettings } from '@/composables/useSettings'
import { toast } from '@/composables/useToasts'
import { formatBytes, formatDuration, formatResolution } from '@/utils/format'

/**
 * The upload form. Opens for one clip (see `uploadDialog` in useUploads) and
 * hands a validated request to main, which queues it; progress then arrives
 * through `uploads:changed` like any other job.
 *
 * Two columns: what the video says (title, description, tags) on the left,
 * how it is published (visibility, playlist, audience, project) on the right,
 * with the clip itself across the top so there is never a doubt which file
 * is about to leave.
 */
const api = window.api

const open = computed({
  get: () => uploadDialog.value !== null,
  set: (v: boolean) => {
    if (!v) closeUploadDialog()
  },
})
const clip = computed(() => uploadDialog.value)

const PRIVACY_ITEMS: Array<{ value: YouTubePrivacy; label: string; description: string }> = [
  {
    value: 'unlisted',
    label: 'Unlisted',
    description: 'Anyone with the link can watch. Not listed on your channel or in search.',
  },
  { value: 'public', label: 'Public', description: 'Anyone can find and watch it.' },
  { value: 'private', label: 'Private', description: 'Only you can see it.' },
]

// ------------------------------------------------------------------- form

const title = ref('')
const description = ref('')
const tags = ref<string[]>([])
const privacy = ref<YouTubePrivacy>('unlisted')
const playlistId = ref('')
const madeForKids = ref(false)
/** '' = Auto. */
const accountId = ref('')
const submitting = ref(false)

const playlists = ref<YouTubePlaylist[]>([])
const playlistsLoading = ref(false)
const newPlaylistOpen = ref(false)
const newPlaylistTitle = ref('')
const creatingPlaylist = ref(false)

/** The project the upload will go through: the chosen one, or Auto's pick right now. */
const effective = computed<YouTubeAccount | null>(() =>
  accountId.value ? (accountById(accountId.value) ?? null) : autoPick(),
)

interface AccountItem {
  id: string
  label: string
  account: YouTubeAccount | null
  disabled?: boolean
}

const accountItems = computed<AccountItem[]>(() => {
  const auto = autoPick()
  const items: AccountItem[] = [
    {
      id: '',
      label: auto ? `Auto · ${auto.label}` : 'Auto · every project is out of quota',
      account: null,
      disabled: !auto,
    },
  ]
  for (const a of connectedAccounts.value) {
    items.push({
      id: a.id,
      label: isExhausted(a)
        ? `${a.label} · ${quotaResumesIn(a)}`
        : a.channel?.title
          ? `${a.label} · ${a.channel.title}`
          : a.label,
      account: a,
      disabled: isExhausted(a),
    })
  }
  return items
})

const playlistItems = computed(() => [
  { id: '', title: 'No playlist' },
  ...playlists.value.map((p) => ({ id: p.id, title: p.title })),
])
const playlistTitle = computed(
  () => playlists.value.find((p) => p.id === playlistId.value)?.title ?? '',
)

const request = computed<UploadRequest | null>(() =>
  clip.value
    ? {
        clipId: clip.value.id,
        title: title.value,
        description: description.value,
        tags: tags.value,
        privacy: privacy.value,
        playlistId: playlistId.value,
        madeForKids: madeForKids.value,
        accountId: accountId.value,
      }
    : null,
)
const problem = computed(() => (request.value ? validateUploadRequest(request.value) : null))
/** Only a fault in the title itself marks the field; an empty title just keeps Upload disabled. */
const titleError = computed(() => {
  const p = problem.value
  return title.value.trim() && p && /title/i.test(p) ? p : undefined
})
const tagsRemaining = computed(() => YOUTUBE_LIMITS.tagsTotal - tagsLength(tags.value))
const canSubmit = computed(
  () => Boolean(request.value) && !problem.value && anyConnected.value && effective.value !== null,
)

const poster = computed(() => (clip.value?.thumb ? api.thumbUrl(clip.value.thumb) : ''))
const facts = computed(() => {
  const c = clip.value
  if (!c) return ''
  return [
    c.game,
    c.duration ? formatDuration(c.duration) : '',
    formatResolution(c.width, c.height, c.fps),
    formatBytes(c.size),
  ]
    .filter(Boolean)
    .join(' · ')
})

/** Where it lands, in one line: the channel, and the project when there is more than one. */
const destination = computed(() => {
  const a = effective.value
  if (!a) return 'No project can take this upload right now.'
  const who = a.channel?.title ?? a.label
  return connectedAccounts.value.length > 1 ? `${who} · via ${a.label}` : who
})

/** The footer's one-line readback of what Upload will do. */
const summary = computed(() => {
  const vis = PRIVACY_ITEMS.find((p) => p.value === privacy.value)?.label ?? ''
  return [vis, playlistTitle.value ? `Playlist: ${playlistTitle.value}` : 'No playlist']
    .filter(Boolean)
    .join(' · ')
})

// ---------------------------------------------------------------- effects

watch(clip, (c) => {
  if (!c) return
  title.value = c.title
  description.value = c.game
  tags.value = c.game ? [c.game] : []
  privacy.value = 'unlisted'
  playlistId.value = ''
  madeForKids.value = false
  accountId.value = ''
  newPlaylistOpen.value = false
  newPlaylistTitle.value = ''
})

/** Playlists belong to a channel, so they follow whichever project is in play. */
watch(
  () => effective.value?.id ?? '',
  (id) => {
    playlists.value = []
    if (!id || !clip.value) return
    void fetchPlaylists(id, false)
  },
  { immediate: true },
)

async function fetchPlaylists(id: string, refresh: boolean): Promise<void> {
  playlistsLoading.value = true
  try {
    const list = await loadPlaylists(id, refresh)
    if (list && effective.value?.id === id) {
      playlists.value = list
      if (playlistId.value && !list.some((p) => p.id === playlistId.value)) playlistId.value = ''
    }
  } finally {
    playlistsLoading.value = false
  }
}

async function addPlaylist(): Promise<void> {
  const id = effective.value?.id
  const name = newPlaylistTitle.value.trim()
  if (!id || !name) return
  creatingPlaylist.value = true
  try {
    const created = await createPlaylist(id, name, privacy.value)
    if (!created) return
    playlists.value = [created, ...playlists.value]
    playlistId.value = created.id
    newPlaylistOpen.value = false
    newPlaylistTitle.value = ''
  } finally {
    creatingPlaylist.value = false
  }
}

function toSettings(): void {
  closeUploadDialog()
  closePlayer()
  openSettings('youtube')
}

/**
 * Hands the request to main. Once the queue has taken it the form closes and
 * the card veil takes over as the progress display; a refusal (toasted by
 * startUpload) keeps the form open with everything still filled in.
 */
async function submit(): Promise<void> {
  if (!canSubmit.value || !request.value || submitting.value) return
  const req = request.value
  submitting.value = true
  try {
    const job = await startUpload(req)
    if (!job) return
    closeUploadDialog()
    toast('info', 'Uploading to YouTube', job.title)
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <UModal
    v-model:open="open"
    title="Upload to YouTube"
    :description="destination"
    :ui="{
      content: 'max-w-4xl',
      header: 'pe-12 sm:pe-12',
      title: 'font-heading text-lg',
      description: 'text-sm',
      body: 'p-0 sm:p-0',
      footer: 'justify-between gap-4',
    }"
  >
    <template #body>
      <div v-if="clip" class="body" @keydown.ctrl.enter.prevent="submit">
        <!-- The file about to leave, so there is never a doubt which one it is. -->
        <div class="clip">
          <div class="poster">
            <img v-if="poster" :src="poster" alt="" decoding="async" />
            <UBadge
              v-if="clip.duration"
              class="poster-duration mono"
              size="sm"
              :label="formatDuration(clip.duration)"
            />
          </div>
          <div class="clip-text">
            <p class="eyebrow">Clip</p>
            <p class="clip-title truncate" :title="clip.name + clip.ext">{{ clip.title }}</p>
            <p class="clip-facts truncate">{{ facts }}</p>
          </div>
        </div>

        <UAlert
          v-if="!anyConnected"
          color="warning"
          variant="subtle"
          icon="i-lucide-plug-zap"
          title="No YouTube project is connected"
          description="Add a Google project and connect it before uploading."
          :actions="[
            {
              label: 'Open YouTube settings',
              color: 'neutral',
              variant: 'outline',
              size: 'xs',
              onClick: toSettings,
            },
          ]"
        />
        <!-- Auto has nothing left to pick: say so here, not only as a greyed-out option. -->
        <UAlert
          v-else-if="!effective"
          color="warning"
          variant="subtle"
          icon="i-lucide-hourglass"
          title="Every project is out of quota for today"
          description="YouTube hands each project a fresh daily quota at midnight Pacific. Add another Google project to keep uploading before then."
          :actions="[
            {
              label: 'Open YouTube settings',
              color: 'neutral',
              variant: 'outline',
              size: 'xs',
              onClick: toSettings,
            },
          ]"
        />

        <div class="columns" :class="{ 'is-disabled': !anyConnected }">
          <section class="col" aria-labelledby="upload-details">
            <h4 id="upload-details" class="section-title">Details</h4>

            <UFormField
              label="Title"
              :error="titleError"
              :hint="`${title.trim().length}/${YOUTUBE_LIMITS.title}`"
              size="lg"
            >
              <UInput
                v-model="title"
                :maxlength="YOUTUBE_LIMITS.title"
                placeholder="What is this clip?"
                class="w-full"
                autofocus
              />
            </UFormField>

            <UFormField
              label="Description"
              :hint="`${description.length}/${YOUTUBE_LIMITS.description}`"
              help="Shows under the video. Links and hashtags work here."
            >
              <UTextarea
                v-model="description"
                :rows="6"
                :maxlength="YOUTUBE_LIMITS.description"
                class="w-full"
              />
            </UFormField>

            <UFormField
              label="Tags"
              :hint="`${tagsRemaining} characters left`"
              :error="tagsRemaining < 0 ? 'Too many tag characters.' : undefined"
              help="Type a tag and press Enter. They help YouTube file the video, but viewers never see them."
            >
              <UInputTags v-model="tags" placeholder="Add a tag" class="w-full" />
            </UFormField>
          </section>

          <section class="col" aria-labelledby="upload-publish">
            <h4 id="upload-publish" class="section-title">Publish</h4>

            <UFormField
              v-if="connectedAccounts.length > 1"
              label="Upload with"
              help="Auto uses the first project that still has quota, and moves on if Google says it is spent."
            >
              <USelectMenu
                v-model="accountId"
                :items="accountItems"
                value-key="id"
                label-key="label"
                :search-input="false"
                class="w-full"
              >
                <template #item="{ item }">
                  <div class="acct">
                    <UAvatar
                      v-if="item.account"
                      :src="item.account.channel?.avatar || undefined"
                      :alt="item.account.label"
                      size="2xs"
                    />
                    <UIcon v-else name="i-lucide-wand-sparkles" class="size-4" />
                    <span class="acct-label truncate">{{ item.label }}</span>
                  </div>
                </template>
              </USelectMenu>
            </UFormField>

            <UFormField
              label="Visibility"
              help="Until Google audits your project, YouTube keeps every upload private whatever you pick here. Sift will tell you if that happens."
            >
              <URadioGroup
                v-model="privacy"
                :items="PRIVACY_ITEMS"
                variant="card"
                class="w-full"
                :ui="{ fieldset: 'gap-2', item: 'w-full' }"
              />
            </UFormField>

            <UFormField label="Playlist">
              <div class="playlist-row">
                <USelectMenu
                  v-model="playlistId"
                  :items="playlistItems"
                  value-key="id"
                  label-key="title"
                  :loading="playlistsLoading"
                  :disabled="!effective"
                  class="grow"
                />
                <UTooltip text="Reload playlists">
                  <UButton
                    icon="i-lucide-refresh-cw"
                    color="neutral"
                    variant="subtle"
                    square
                    :disabled="!effective"
                    aria-label="Reload playlists"
                    @click="effective && fetchPlaylists(effective.id, true)"
                  />
                </UTooltip>
                <UButton
                  icon="i-lucide-plus"
                  label="New"
                  color="neutral"
                  variant="subtle"
                  :disabled="!effective"
                  :aria-pressed="newPlaylistOpen"
                  @click="newPlaylistOpen = !newPlaylistOpen"
                />
              </div>
              <div v-if="newPlaylistOpen" class="playlist-row new">
                <UInput
                  v-model="newPlaylistTitle"
                  placeholder="New playlist name"
                  class="grow"
                  autofocus
                  @keydown.enter.prevent="addPlaylist"
                />
                <UButton
                  label="Create"
                  color="primary"
                  variant="soft"
                  :loading="creatingPlaylist"
                  :disabled="!newPlaylistTitle.trim()"
                  @click="addPlaylist"
                />
              </div>
            </UFormField>

            <div class="kids">
              <div class="kids-text">
                <p class="kids-title">Made for kids</p>
                <p class="kids-desc">
                  YouTube asks this for every upload. Game clips are almost never made for kids.
                </p>
              </div>
              <USwitch v-model="madeForKids" aria-label="Made for kids" />
            </div>
          </section>
        </div>
      </div>
    </template>
    <template #footer>
      <p class="summary truncate" :title="summary">
        <template v-if="problem">
          <span class="summary-problem">{{ problem }}</span>
        </template>
        <template v-else>{{ summary }}</template>
      </p>
      <div class="footer-actions">
        <UButton label="Cancel" color="neutral" variant="ghost" @click="open = false" />
        <UTooltip text="Ctrl + Enter">
          <UButton
            icon="i-lucide-upload"
            label="Upload"
            color="primary"
            variant="soft"
            :disabled="!canSubmit"
            :loading="submitting"
            @click="submit"
          />
        </UTooltip>
      </div>
    </template>
  </UModal>
</template>

<style scoped>
.body {
  display: flex;
  flex-direction: column;
  gap: var(--s-6);
  max-height: min(72vh, 760px);
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: var(--s-6);
}

/* ---------------------------------------------------------------- clip */
.clip {
  display: flex;
  align-items: center;
  gap: var(--s-5);
  padding: var(--s-4);
  border-radius: var(--r-lg);
  background: var(--bg-2);
  box-shadow: inset 0 0 0 1px var(--border);
}
.poster {
  position: relative;
  width: 176px;
  aspect-ratio: 16 / 9;
  flex: 0 0 auto;
  border-radius: var(--r-md);
  overflow: hidden;
  background: var(--bg-0);
  box-shadow: inset 0 0 0 1px var(--border);
}
.poster img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.poster-duration {
  position: absolute;
  right: 6px;
  bottom: 6px;
  background: var(--chip-bg);
  color: var(--fg-strong);
  font-family: var(--font-heading);
  font-weight: 600;
}
.clip-text {
  min-width: 0;
}
.eyebrow {
  font-family: var(--font-heading);
  font-size: var(--text-xs);
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--fg-dim);
}
.clip-title {
  margin-top: 2px;
  font-size: var(--text-lg);
  font-weight: 600;
  color: var(--fg);
}
.clip-facts {
  margin-top: 4px;
  font-size: var(--text-sm);
  color: var(--fg-muted);
}

/* ------------------------------------------------------------- columns */
.columns {
  display: grid;
  grid-template-columns: minmax(0, 3fr) minmax(0, 2fr);
  gap: var(--s-8);
  align-items: start;
}
.columns.is-disabled {
  opacity: 0.5;
  pointer-events: none;
}
.col {
  display: flex;
  flex-direction: column;
  gap: var(--s-5);
  min-width: 0;
}
.section-title {
  font-family: var(--font-heading);
  font-size: var(--text-xs);
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--fg-dim);
  padding-bottom: var(--s-2);
  border-bottom: 1px solid var(--border);
}

.acct {
  display: flex;
  align-items: center;
  gap: var(--s-2);
  min-width: 0;
  width: 100%;
}
.acct-label {
  flex: 1;
  min-width: 0;
}
.playlist-row {
  display: flex;
  align-items: center;
  gap: var(--s-2);
}
.playlist-row.new {
  margin-top: var(--s-2);
}
.grow {
  flex: 1;
  min-width: 0;
}
.kids {
  display: flex;
  align-items: center;
  gap: var(--s-4);
  padding: var(--s-3) var(--s-4);
  border-radius: var(--r-md);
  background: var(--bg-2);
  box-shadow: inset 0 0 0 1px var(--border);
}
.kids-text {
  flex: 1;
  min-width: 0;
}
.kids-title {
  font-weight: 600;
  font-size: var(--text-base);
}
.kids-desc {
  margin-top: 2px;
  font-size: var(--text-sm);
  color: var(--fg-muted);
}

/* -------------------------------------------------------------- footer */
.summary {
  flex: 1;
  min-width: 0;
  font-size: var(--text-sm);
  color: var(--fg-muted);
}
.summary-problem {
  color: var(--warning);
}
.footer-actions {
  display: flex;
  align-items: center;
  gap: var(--s-2);
  flex: 0 0 auto;
}
</style>
