<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { Clip } from '@shared/types'
import FavouriteButton from './FavouriteButton.vue'
import {
  checkOnYouTube,
  clipsFolder,
  copyClipFile,
  copyClipPath,
  copyYouTubeLink,
  getClip,
  now,
  openYouTube,
  pendingByClip,
  removeFromYouTube,
  renameClip,
  revealClip,
} from '@/composables/useLibrary'
import { cancelUpload, progressText, stageText, uploadByClip } from '@/composables/useUploads'
import { youtubeUrl } from '@shared/youtube'
import {
  dirname,
  formatBytes,
  formatDuration,
  formatFull,
  formatRelative,
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
/** The live upload's one line, for the progress row above the actions. */
const uploadStatus = computed(() => {
  const u = upload.value
  if (u?.state === 'uploading') return `Uploading · ${progressText(u)}`
  if (u?.state === 'queued') return 'Waiting to upload'
  return ''
})
const videoUrl = computed(() => (props.clip.youtubeId ? youtubeUrl(props.clip.youtubeId) : ''))

/** What YouTube last said about the video, in the same words the cards use. */
const stage = computed(() => {
  const clip = props.clip
  if (!clip.youtubeId) return null
  const job = upload.value
  if (job && (job.state === 'processing' || job.state === 'done' || job.state === 'failed')) {
    const line = stageText(job)
    if (line)
      return {
        line,
        bad: job.state === 'failed',
        busy: job.state === 'processing' && !job.checksStopped,
      }
  }
  switch (clip.youtubeStage) {
    case 'processing':
      // Spin only while Sift is still asking; a stopped check is a clock, not a loader.
      return {
        line:
          clip.youtubeWatchUntilMs > now.value
            ? 'Processing on YouTube'
            : 'Still processing on YouTube',
        bad: false,
        busy: clip.youtubeWatchUntilMs > now.value,
      }
    case 'ready':
      return { line: 'Ready on YouTube', bad: false, busy: false }
    case 'rejected':
      return { line: clip.youtubeReason || 'YouTube rejected this video', bad: true, busy: false }
    case 'failed':
      return {
        line: clip.youtubeReason || 'YouTube could not process this video',
        bad: true,
        busy: false,
      }
    default:
      return null
  }
})

/** "Checked 4 minutes ago", so a stale answer never reads as a fresh one. */
const checkedLine = computed(() =>
  props.clip.youtubeCheckedAtMs
    ? `Checked ${formatRelative(props.clip.youtubeCheckedAtMs, now.value).toLowerCase()}`
    : '',
)

const checking = computed(() => pendingAction.value?.kind === 'check-youtube')
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
        icon="i-lucide-pencil"
        spellcheck="false"
        autocomplete="off"
        placeholder="File name"
        :loading="pendingAction?.kind === 'rename'"
        :disabled="busy"
        :ui="{ base: 'font-heading font-semibold text-base', trailing: 'pe-3' }"
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
          :color="stage?.bad ? 'warning' : 'error'"
          variant="subtle"
          size="md"
          :icon="stage?.busy ? 'i-lucide-loader-circle' : 'i-lucide-youtube'"
          :label="stage?.busy ? 'Processing' : stage?.bad ? 'Not published' : 'On YouTube'"
          :ui="stage?.busy ? { leadingIcon: 'animate-spin' } : undefined"
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
        <!-- The upload is not the end of it: YouTube still has to process the
             video, and it can still refuse it. This is that answer, so the
             user never has to open Studio to get it. -->
        <div v-if="stage" class="link-row static">
          <UIcon
            :name="
              stage.busy
                ? 'i-lucide-loader-circle'
                : stage.bad
                  ? 'i-lucide-triangle-alert'
                  : 'i-lucide-circle-check'
            "
            class="row-icon"
            :class="{ 'animate-spin': stage.busy, 'is-bad': stage.bad }"
          />
          <span class="link-text">
            <span class="link-title">{{ stage.line }}</span>
            <span v-if="checkedLine" class="link-sub truncate">{{ checkedLine }}</span>
          </span>
          <span class="row-actions">
            <UTooltip text="Ask YouTube how the video is doing">
              <UButton
                icon="i-lucide-refresh-cw"
                label="Check now"
                color="neutral"
                variant="subtle"
                size="sm"
                :loading="checking"
                @click="checkOnYouTube(clip)"
              />
            </UTooltip>
          </span>
        </div>
        <div class="link-row static">
          <UIcon name="i-lucide-youtube" class="row-icon" />
          <span class="link-text">
            <span class="link-title truncate">On your channel</span>
            <span class="link-sub mono truncate" :title="videoUrl">{{ videoUrl }}</span>
          </span>
          <span class="row-actions">
            <UButton
              icon="i-lucide-external-link"
              label="Open"
              color="neutral"
              variant="subtle"
              size="sm"
              aria-label="Open on YouTube"
              @click="openYouTube(clip)"
            />
            <UButton
              icon="i-lucide-link-2"
              label="Copy link"
              color="neutral"
              variant="subtle"
              size="sm"
              aria-label="Copy YouTube link"
              @click="copyYouTubeLink(clip)"
            />
          </span>
        </div>
        <!-- Under the row, quiet and unfilled, like Delete in the footer: the
             video is gone from the channel for good, so it is reachable
             without ever sitting under a pointer aimed at Open. -->
        <UButton
          class="yt-remove"
          icon="i-lucide-cloud-off"
          label="Remove from YouTube"
          color="error"
          variant="ghost"
          size="sm"
          :loading="pendingAction?.kind === 'remove-youtube'"
          :disabled="busy || uploading"
          @click="removeFromYouTube(clip)"
        />
      </section>

      <section>
        <h4>Location</h4>
        <button type="button" class="link-row" title="Show in Explorer" @click="revealClip(clip)">
          <UIcon name="i-lucide-folder-open" class="row-icon" />
          <span class="link-text">
            <span class="link-title truncate">Show in Explorer</span>
            <span class="link-sub path" :title="clip.path">{{ folder }}</span>
          </span>
          <UIcon name="i-lucide-chevron-right" class="row-chev" />
        </button>
        <UButton
          class="path-copy"
          icon="i-lucide-copy"
          label="Copy path"
          color="neutral"
          variant="ghost"
          size="sm"
          aria-label="Copy the file path"
          @click="copyClipPath(clip)"
        />
      </section>
    </div>

    <footer class="actions">
      <UButton
        icon="i-lucide-scissors"
        :label="editing ? 'Cancel trim' : 'Trim & export'"
        :color="editing ? 'neutral' : 'primary'"
        :variant="editing ? 'subtle' : 'solid'"
        block
        :disabled="!canEdit"
        @click="$emit('edit')"
      />
      <!-- A live upload gets its own row with its own Cancel; the Upload button
           below never turns into something else under the pointer. -->
      <div v-if="uploading && upload" class="upload-row" role="status">
        <UIcon name="i-lucide-cloud-upload" class="upload-icon" />
        <span class="upload-text truncate">{{ uploadStatus }}</span>
        <UButton
          label="Cancel"
          color="neutral"
          variant="subtle"
          size="sm"
          @click="cancelUpload(upload.id)"
        />
        <UProgress
          class="upload-bar"
          :model-value="upload.state === 'uploading' ? Math.round(upload.progress * 100) : null"
          size="xs"
          color="primary"
          :aria-label="uploadStatus"
        />
      </div>
      <div class="actions-row">
        <UTooltip :text="clip.youtubeId ? 'Upload to YouTube again' : 'Upload to YouTube'">
          <UButton
            class="grow"
            icon="i-lucide-youtube"
            :label="clip.youtubeId ? 'Upload again' : 'Upload'"
            color="neutral"
            variant="subtle"
            block
            :disabled="clip.probeState !== 'ok' || busy || uploading"
            @click="$emit('upload')"
          />
        </UTooltip>
        <UButton
          class="grow"
          icon="i-lucide-clipboard-copy"
          label="Copy file"
          color="neutral"
          variant="subtle"
          block
          :loading="pendingAction?.kind === 'copy-file'"
          :disabled="busy"
          @click="copyClipFile(clip)"
        />
      </div>
      <!-- On its own line, small and unfilled: reachable, never in the way. -->
      <UButton
        class="danger"
        icon="i-lucide-trash-2"
        label="Delete"
        color="error"
        variant="ghost"
        size="sm"
        :loading="pendingAction?.kind === 'delete'"
        :disabled="busy"
        @click="$emit('remove')"
      />
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
  color: var(--fg-muted);
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
/* A video YouTube would not publish; the same amber the cards use for it. */
.row-icon.is-bad {
  color: var(--warning);
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
/* Under the row rather than beside it: the path needs the width more than the button does. */
.path-copy {
  margin-top: var(--s-2);
}
.yt-remove {
  margin-top: var(--s-2);
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
.upload-row {
  position: relative;
  display: flex;
  align-items: center;
  gap: var(--s-2);
  padding: var(--s-2) var(--s-3) calc(var(--s-2) + 3px);
  border-radius: var(--r-md);
  background: var(--bg-2);
  box-shadow: inset 0 0 0 1px var(--border);
  overflow: hidden;
}
.upload-icon {
  flex: none;
  width: 18px;
  height: 18px;
  color: var(--secondary);
}
.upload-text {
  flex: 1;
  min-width: 0;
  font-size: var(--text-sm);
}
.upload-bar {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
}
.danger {
  align-self: flex-end;
}
</style>
