<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { Clip } from '@shared/types'
import FavouriteButton from './FavouriteButton.vue'
import {
  clipsFolder,
  copyClipFile,
  copyClipPath,
  copyYouTubeLink,
  getClip,
  openYouTube,
  pendingByClip,
  renameClip,
  revealClip,
} from '@/composables/useLibrary'
import { cancelUpload, progressText, uploadByClip } from '@/composables/useUploads'
import { youtubeUrl } from '@shared/youtube'
import {
  dirname,
  formatBytes,
  formatDuration,
  formatFull,
  formatResolution,
  formatTimecode,
} from '@/utils/format'
import { bitrate, formatBitrate, qualityTier } from '@/utils/quality'

/**
 * The pane beside the video. Facts sit in one table, and each place you could
 * go — the source recording, the YouTube page, the folder on disk — is a row
 * you press rather than a table plus a button. The name at the top is a field:
 * type, leave it, and the file is renamed.
 */
const props = withDefaults(
  defineProps<{
    clip: Clip
    /** Edit mode shows where the export will land instead of the actions it would replace. */
    editing?: boolean
    /** File name the export will get, with extension. */
    exportName?: string
  }>(),
  { editing: false, exportName: '' },
)
const emit = defineEmits<{
  close: []
  remove: []
  edit: []
  source: []
  upload: []
  /** The rename went through; the record with the new id. */
  renamed: [next: Clip]
}>()

interface Row {
  label: string
  value: string
  /** Numbers get tabular figures so the column does not jitter between clips. */
  mono?: boolean
}

/** ffprobe reports the stream name; these are how people write them. */
const CODEC_LABELS: Record<string, string> = {
  h264: 'H.264',
  avc1: 'H.264',
  hevc: 'HEVC',
  h265: 'HEVC',
  av1: 'AV1',
  vp9: 'VP9',
  vp8: 'VP8',
  mpeg4: 'MPEG-4',
}

const pending = computed(() => props.clip.probeState === 'pending')
const failed = computed(() => props.clip.probeState === 'failed')
const canEdit = computed(() => props.clip.probeState === 'ok' && props.clip.duration > 0)
const tier = computed(() => qualityTier(props.clip))
const codec = computed(() => {
  const c = props.clip.vcodec
  return c ? (CODEC_LABELS[c] ?? c.toUpperCase()) : ''
})
const resolution = computed(() =>
  formatResolution(props.clip.width, props.clip.height, props.clip.fps),
)
const folder = computed(() => dirname(props.clip.path))

const isExport = computed(() => Boolean(props.clip.sourceId))
const upload = computed(() => uploadByClip.value[props.clip.id])
/** A delete, rename, YouTube removal or file copy still in flight for this clip. */
const pendingAction = computed(() => pendingByClip.value[props.clip.id])
const busy = computed(() => Boolean(pendingAction.value))
const uploading = computed(() =>
  Boolean(upload.value && (upload.value.state === 'queued' || upload.value.state === 'uploading')),
)
const uploadLabel = computed(() => {
  const u = upload.value
  if (u?.state === 'uploading') return `Cancel · ${progressText(u)}`
  if (u?.state === 'queued') return 'Cancel · waiting'
  return props.clip.youtubeId ? 'Upload again' : 'Upload to YouTube'
})

/** While a job is live the same button cancels it; otherwise it opens the upload form. */
function onUploadButton(): void {
  const u = upload.value
  if (uploading.value && u) void cancelUpload(u.id)
  else emit('upload')
}
const videoUrl = computed(() => (props.clip.youtubeId ? youtubeUrl(props.clip.youtubeId) : ''))
const sourceClip = computed(() => (props.clip.sourceId ? getClip(props.clip.sourceId) : undefined))
const sourceLine = computed(() => {
  const c = props.clip
  const parts = [`${formatTimecode(c.trimStart)} – ${formatTimecode(c.trimEnd)}`]
  if (c.createdAtMs) parts.push(`Exported ${formatFull(c.createdAtMs)}`)
  return parts.join(' · ')
})
const destination = computed(
  () => `${clipsFolder.value?.name ?? 'Sift Clips'}\\${props.clip.game}\\${props.exportName}`,
)

// ---------------------------------------------------------- inline rename

const nameInput = ref<{ inputRef: HTMLInputElement | null } | null>(null)
const draft = ref(props.clip.name)
const nameFocused = ref(false)

// A rename elsewhere (the More menu, the context menu) or a step to another
// clip refreshes the field — unless you are mid-edit in it.
watch(
  () => [props.clip.id, props.clip.name],
  () => {
    if (!nameFocused.value) draft.value = props.clip.name
  },
)

async function commitName(): Promise<void> {
  nameFocused.value = false
  const next = draft.value.trim()
  if (!next || next === props.clip.name) {
    draft.value = props.clip.name
    return
  }
  const renamed = await renameClip(props.clip, next)
  if (renamed) emit('renamed', renamed)
  else draft.value = props.clip.name
}

function cancelName(): void {
  draft.value = props.clip.name
  nameInput.value?.inputRef?.blur()
}

// ------------------------------------------------------------------ rows

const rows = computed<Row[]>(() => {
  const c = props.clip
  const dims = c.width && c.height ? `${c.width} × ${c.height}` : ''
  const fps = c.fps ? `${Math.round(c.fps)} fps` : ''
  const rate = formatBitrate(bitrate(c))
  return [
    { label: 'Duration', value: c.duration ? formatDuration(c.duration) : '', mono: true },
    { label: 'Resolution', value: [dims, fps].filter(Boolean).join(' · '), mono: true },
    { label: 'Codec', value: [codec.value, rate].filter(Boolean).join(' · ') },
    {
      label: 'Audio',
      value: c.probeState === 'ok' ? (c.hasAudio ? 'Included' : c.muted ? 'Removed' : 'None') : '',
    },
    {
      label: 'Size',
      value: [formatBytes(c.size), c.ext.replace('.', '').toUpperCase()].join(' · '),
      mono: true,
    },
    { label: 'Recorded', value: formatFull(c.recordedAtMs) },
    { label: 'Game', value: c.game },
  ]
})
</script>

<template>
  <aside class="details" aria-label="Clip details">
    <header class="head">
      <div class="head-row">
        <label class="name-label" for="clip-name">File name</label>
        <span class="name-hint" aria-live="polite">
          {{ nameFocused ? 'Enter saves · Esc cancels' : 'Click to rename' }}
        </span>
        <FavouriteButton :clip="clip" />
        <UTooltip text="Hide details" :kbds="['I']">
          <UButton
            icon="i-lucide-panel-right-close"
            color="neutral"
            variant="ghost"
            square
            size="lg"
            aria-label="Hide details"
            @click="$emit('close')"
          />
        </UTooltip>
      </div>
      <!-- The name is the field. Leave it or press Enter to rename; Esc puts it back. -->
      <UInput
        id="clip-name"
        ref="nameInput"
        v-model="draft"
        class="name"
        variant="subtle"
        size="lg"
        icon="i-lucide-pencil"
        spellcheck="false"
        autocomplete="off"
        placeholder="File name"
        :loading="pendingAction?.kind === 'rename'"
        :disabled="busy"
        :ui="{ base: 'font-heading font-semibold text-[15px]', trailing: 'pe-3' }"
        @focus="nameFocused = true"
        @blur="commitName"
        @keydown.enter.prevent="nameInput?.inputRef?.blur()"
        @keydown.esc.prevent="cancelName"
      >
        <template #trailing>
          <span class="ext mono">{{ clip.ext }}</span>
        </template>
      </UInput>
    </header>

    <div class="scroll">
      <div class="chips">
        <UBadge
          :color="tier.color"
          variant="soft"
          size="md"
          icon="i-lucide-gauge"
          :label="tier.label"
        />
        <UBadge v-if="resolution" color="neutral" variant="subtle" size="md" :label="resolution" />
        <UBadge v-if="codec" color="neutral" variant="subtle" size="md" :label="codec" />
        <UBadge
          v-if="clip.youtubeId"
          color="error"
          variant="subtle"
          size="md"
          icon="i-lucide-youtube"
          label="On YouTube"
        />
        <UBadge
          v-if="isExport"
          color="primary"
          variant="subtle"
          size="md"
          icon="i-lucide-scissors"
          label="Clip"
        />
      </div>

      <UAlert
        v-if="failed"
        class="probe-alert"
        icon="i-lucide-triangle-alert"
        color="warning"
        variant="soft"
        title="Media info unavailable"
        description="This file could not be probed, so some values below are missing."
      />

      <section v-if="editing">
        <h4>Export</h4>
        <p class="path" :title="destination">{{ destination }}</p>
        <p class="note">
          Stream copy, no re-encode. The start snaps to the keyframe just before it, so the clip can
          begin a fraction of a second early.
        </p>
      </section>

      <section>
        <h4>Details</h4>
        <dl class="rows">
          <div v-for="row in rows" :key="row.label" class="row">
            <dt>{{ row.label }}</dt>
            <dd v-if="row.value" :class="{ mono: row.mono }" :title="row.value">{{ row.value }}</dd>
            <USkeleton v-else-if="pending" class="h-3.5 w-20" />
            <dd v-else class="empty">—</dd>
          </div>
        </dl>
      </section>

      <section v-if="isExport">
        <h4>Source</h4>
        <button
          type="button"
          class="link-row"
          :disabled="!sourceClip"
          :title="sourceClip ? 'Open the recording this was cut from' : ''"
          @click="$emit('source')"
        >
          <UIcon name="i-lucide-link" class="row-icon" />
          <span class="link-text">
            <span class="link-title truncate">
              {{ sourceClip ? `Cut from ${sourceClip.title}` : 'Source recording is gone' }}
            </span>
            <span class="link-sub mono truncate">{{ sourceLine }}</span>
          </span>
          <UIcon v-if="sourceClip" name="i-lucide-chevron-right" class="row-chev" />
        </button>
      </section>

      <section v-if="videoUrl">
        <h4>YouTube</h4>
        <div class="link-row static">
          <UIcon name="i-lucide-youtube" class="row-icon" />
          <span class="link-text">
            <span class="link-title truncate">On your channel</span>
            <span class="link-sub mono truncate" :title="videoUrl">{{ videoUrl }}</span>
          </span>
          <span class="row-actions">
            <UTooltip text="Open on YouTube">
              <UButton
                icon="i-lucide-external-link"
                color="neutral"
                variant="ghost"
                square
                size="md"
                aria-label="Open on YouTube"
                @click="openYouTube(clip)"
              />
            </UTooltip>
            <UTooltip text="Copy link">
              <UButton
                icon="i-lucide-link-2"
                color="neutral"
                variant="ghost"
                square
                size="md"
                aria-label="Copy YouTube link"
                @click="copyYouTubeLink(clip)"
              />
            </UTooltip>
          </span>
        </div>
      </section>

      <section>
        <h4>Location</h4>
        <div class="link-pair">
          <button type="button" class="link-row" title="Show in Explorer" @click="revealClip(clip)">
            <UIcon name="i-lucide-folder-open" class="row-icon" />
            <span class="link-text">
              <span class="link-title truncate">Show in Explorer</span>
              <span class="link-sub path" :title="clip.path">{{ folder }}</span>
            </span>
            <UIcon name="i-lucide-chevron-right" class="row-chev" />
          </button>
          <UTooltip text="Copy path">
            <UButton
              class="pair-btn"
              icon="i-lucide-copy"
              color="neutral"
              variant="subtle"
              square
              size="lg"
              aria-label="Copy path"
              @click="copyClipPath(clip)"
            />
          </UTooltip>
        </div>
      </section>
    </div>

    <footer class="actions">
      <UButton
        icon="i-lucide-scissors"
        :label="editing ? 'Leave edit mode' : 'Trim & export'"
        :color="editing ? 'neutral' : 'primary'"
        :variant="editing ? 'subtle' : 'solid'"
        size="lg"
        block
        :disabled="!canEdit"
        @click="$emit('edit')"
      />
      <div class="actions-row">
        <UButton
          class="grow"
          :icon="uploading ? 'i-lucide-x' : 'i-lucide-youtube'"
          :color="uploading ? 'error' : 'neutral'"
          :label="uploadLabel"
          variant="subtle"
          size="lg"
          block
          :disabled="clip.probeState !== 'ok' || busy"
          @click="onUploadButton"
        />
        <UTooltip text="Copy file">
          <UButton
            icon="i-lucide-clipboard-copy"
            color="neutral"
            variant="subtle"
            square
            size="lg"
            aria-label="Copy file"
            :loading="pendingAction?.kind === 'copy-file'"
            :disabled="busy"
            @click="copyClipFile(clip)"
          />
        </UTooltip>
        <UTooltip text="Delete">
          <UButton
            class="danger"
            icon="i-lucide-trash-2"
            color="error"
            variant="subtle"
            square
            size="lg"
            aria-label="Delete"
            :loading="pendingAction?.kind === 'delete'"
            :disabled="busy"
            @click="$emit('remove')"
          />
        </UTooltip>
      </div>
    </footer>
  </aside>
</template>

<style scoped>
.details {
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  z-index: 3;
  width: var(--details-w);
  display: flex;
  flex-direction: column;
  background: var(--bg-1);
  border-left: 1px solid var(--border);
  box-shadow: -30px 0 60px -40px rgba(0, 0, 0, 0.9);
  cursor: default;
}
.head {
  display: flex;
  flex-direction: column;
  gap: var(--s-2);
  padding: var(--s-2) var(--s-4) var(--s-4);
  border-bottom: 1px solid var(--border);
}
.head-row {
  display: flex;
  align-items: center;
  gap: var(--s-2);
}
.name-label {
  font-family: var(--font-heading);
  font-size: var(--text-sm);
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--fg-muted);
  /* The row ends in two buttons; without this the label is the thing that gives,
     and "FILE NAME" breaks across two lines in a 320px pane. */
  flex: 0 0 auto;
  white-space: nowrap;
}
.name-hint {
  flex: 1;
  min-width: 0;
  font-size: var(--text-sm);
  color: var(--fg-dim);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.name {
  width: 100%;
}
/* A field that says so: the hairline brightens on hover before you commit to a click. */
.name :deep(input) {
  color: var(--fg);
  cursor: text;
}
.ext {
  font-size: var(--text-sm);
  color: var(--fg-muted);
}
.scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: var(--s-5);
  display: flex;
  flex-direction: column;
  gap: var(--s-5);
}
.chips {
  display: flex;
  flex-wrap: wrap;
  gap: var(--s-2);
}
.probe-alert {
  /* Sits between the chips and the tables, so it needs no margin of its own. */
  width: 100%;
}
h4 {
  margin-bottom: var(--s-2);
  font-size: var(--text-sm);
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--fg-muted);
}
.rows {
  margin: 0;
  border-radius: var(--r-md);
  background: var(--bg-2);
  box-shadow: inset 0 0 0 1px var(--border);
}
.row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--s-4);
  min-height: 40px;
  padding: var(--s-2) var(--s-4);
}
.row + .row {
  border-top: 1px solid var(--border);
}
.row dt {
  flex: none;
  font-size: var(--text-base);
  color: var(--fg-muted);
}
.row dd {
  margin: 0;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: var(--text-base);
  font-weight: 500;
  color: var(--fg);
  user-select: text;
}
.row dd.empty {
  color: var(--fg-dim);
}
.path {
  padding: var(--s-3) var(--s-4);
  border-radius: var(--r-md);
  background: var(--bg-2);
  box-shadow: inset 0 0 0 1px var(--border);
  font-family: var(--font-mono);
  font-size: var(--text-sm);
  line-height: 1.6;
  color: var(--fg-muted);
  word-break: break-all;
  user-select: text;
}
.note {
  margin-top: var(--s-2);
  font-size: var(--text-sm);
  line-height: 1.5;
  color: var(--fg-muted);
}

/* A place you can go: one row, pressed whole. */
.link-row {
  display: flex;
  align-items: center;
  gap: var(--s-3);
  width: 100%;
  min-height: 56px;
  padding: var(--s-3) var(--s-4);
  border-radius: var(--r-md);
  background: var(--bg-2);
  box-shadow: inset 0 0 0 1px var(--border);
  color: var(--fg);
  text-align: left;
  cursor: pointer;
  transition:
    background var(--dur-fast) var(--ease-out),
    box-shadow var(--dur-fast) var(--ease-out);
}
.link-row:hover:not(:disabled) {
  background: var(--bg-3);
  box-shadow: inset 0 0 0 1px var(--border-hover);
}
.link-row:disabled {
  cursor: default;
  color: var(--fg-muted);
}
.link-row.static {
  cursor: default;
}
.link-row.static:hover {
  background: var(--bg-2);
  box-shadow: inset 0 0 0 1px var(--border);
}
.row-icon {
  flex: none;
  width: 20px;
  height: 20px;
  color: var(--secondary);
}
.link-row:disabled .row-icon {
  color: var(--fg-dim);
}
.link-text {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.link-title {
  font-size: var(--text-base);
  font-weight: 500;
}
.link-sub {
  font-size: var(--text-sm);
  color: var(--fg-muted);
}
.link-sub.path {
  white-space: normal;
  word-break: break-all;
  line-height: 1.45;
}
.row-chev {
  flex: none;
  width: 18px;
  height: 18px;
  color: var(--fg-dim);
  transition: transform var(--dur) var(--ease-spring);
}
.link-row:hover:not(:disabled) .row-chev {
  transform: translateX(3px);
  color: var(--secondary);
}
.row-actions {
  display: flex;
  align-items: center;
  gap: var(--s-1);
  flex: none;
}
/* The row and its one side action share a line; the button matches the row's height. */
.link-pair {
  display: flex;
  align-items: stretch;
  gap: var(--s-2);
}
.link-pair .link-row {
  flex: 1;
  min-width: 0;
}
.pair-btn {
  height: auto;
  align-self: stretch;
}

.actions {
  display: flex;
  flex-direction: column;
  gap: var(--s-2);
  padding: var(--s-4) var(--s-5);
  border-top: 1px solid var(--border);
  background: var(--bg-1);
}
.actions-row {
  display: flex;
  align-items: center;
  gap: var(--s-2);
}
.actions-row .grow {
  flex: 1;
  min-width: 0;
}
</style>
