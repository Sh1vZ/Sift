<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { Clip } from '@shared/types'
import { AUDIO_EXPORT_FORMATS, MAX_GIF_S, imageFormatLabel } from '@shared/types'
import FavouriteButton from './FavouriteButton.vue'
import { shareMenuItems } from '@/composables/useClipMenu'
import { exportKind, exportMuted, inSec, outSec, selectionLength } from '@/composables/useEditor'
import {
  checkOnYouTube,
  clipsFolder,
  copyClipPath,
  copyYouTubeLink,
  getClip,
  now,
  openYouTube,
  pendingByClip,
  removeFromYouTube,
  renameClip,
  revealClip,
  settings,
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
defineEmits<{
  close: []
  remove: []
  edit: []
  source: []
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
/** A screenshot: no quality tier, codec, audio or duration to speak of, and nothing to trim or upload. */
const isImage = computed(() => props.clip.kind === 'image')
const format = computed(() => (isImage.value ? imageFormatLabel(props.clip.ext, true) : ''))
const canEdit = computed(
  () => !isImage.value && props.clip.probeState === 'ok' && props.clip.duration > 0,
)
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
// ------------------------------------------------------- export (trimming)
// The trim row's format switch decides all three: the heading, where the file
// lands, and what it will be. Audio and GIF go to a folder the save dialog
// asks for, so they show the folder the last one went to, or just the name.

const exportHeading = computed(() => {
  switch (exportKind.value) {
    case 'clip':
      return 'Export clip'
    case 'audio':
      return 'Export audio only'
    case 'gif':
      return 'Export GIF'
  }
})
const exportIcon = computed(() => {
  switch (exportKind.value) {
    case 'clip':
      return 'i-lucide-film'
    case 'audio':
      return 'i-lucide-music'
    case 'gif':
      return 'i-lucide-image-play'
  }
})
/** The selection as the trim row holds it: what the file will contain. */
const rangeLine = computed(
  () =>
    `${formatTimecode(inSec.value)} – ${formatTimecode(outSec.value)} · ${formatTimecode(selectionLength.value)} long`,
)
const destination = computed(() => {
  const name = props.exportName
  switch (exportKind.value) {
    case 'clip':
      return `${clipsFolder.value?.name ?? 'Sift Clips'}\\${props.clip.game}\\${name}`
    case 'audio':
      return settings.value.audioExportDir ? `${settings.value.audioExportDir}\\${name}` : name
    case 'gif':
      return settings.value.gifExportDir ? `${settings.value.gifExportDir}\\${name}` : name
  }
})
// One or two plain sentences: what you get, and the one thing worth knowing.
const exportNote = computed(() => {
  switch (exportKind.value) {
    case 'clip':
      return `${exportMuted.value ? 'No audio. ' : ''}Same quality as the recording, no re-encode. It may start a split second early.`
    case 'audio': {
      const format = AUDIO_EXPORT_FORMATS.find((f) => f.ext === settings.value.audioExportExt)
      return `Just the sound, as ${format?.label ?? 'MP3'}. You pick the folder when you save.`
    }
    case 'gif':
      return `${settings.value.gifWidth} px wide at ${settings.value.gifFps} fps, up to ${MAX_GIF_S} s. You pick the folder when you save.`
  }
})

/** The same Share menu the player's header offers; the footer keeps to two lines, so it stays in trim mode too. */
const shareItems = computed(() => shareMenuItems(props.clip))

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
  // On success the player swaps to the re-keyed record and the watch above
  // refreshes the field from it; only a failure needs the old name put back.
  if (!(await renameClip(props.clip, next))) draft.value = props.clip.name
}

function cancelName(): void {
  draft.value = props.clip.name
  nameInput.value?.inputRef?.blur()
}

// ------------------------------------------------------------------ rows

function channels(count: number): string {
  if (count === 1) return 'mono'
  if (count === 2) return 'stereo'
  if (count === 6) return '5.1'
  if (count === 8) return '7.1'
  return count > 0 ? `${count} ch` : ''
}

/**
 * One track reads as it always has. Several are summed up — count, codec,
 * layouts — because the row is one line: naming each track ran past the edge
 * and hid the very detail it was there for. The mixer names them.
 */
function audioValue(c: Clip): string {
  const tracks = c.audioTracks ?? []
  if (tracks.length > 1) {
    const codecs = [...new Set(tracks.map((t) => t.codec.toUpperCase()))].join('/')
    const layouts = tracks
      .map((t) => channels(t.channels))
      .filter(Boolean)
      .join(' + ')
    return [`${tracks.length} tracks`, codecs, layouts].filter(Boolean).join(' · ')
  }
  if (c.hasAudio) return 'Included'
  return c.muted ? 'Removed' : 'None'
}

const rows = computed<Row[]>(() => {
  const c = props.clip
  const dims = c.width && c.height ? `${c.width} × ${c.height}` : ''
  if (isImage.value)
    return [
      { label: 'Resolution', value: dims, mono: true },
      { label: 'Format', value: format.value },
      { label: 'Size', value: formatBytes(c.size), mono: true },
      { label: 'Taken', value: formatFull(c.recordedAtMs) },
      { label: 'Game', value: c.game },
    ]
  const fps = c.fps ? `${Math.round(c.fps)} fps` : ''
  const rate = formatBitrate(bitrate(c))
  return [
    { label: 'Duration', value: c.duration ? formatDuration(c.duration) : '', mono: true },
    { label: 'Resolution', value: [dims, fps].filter(Boolean).join(' · '), mono: true },
    { label: 'Codec', value: [codec.value, rate].filter(Boolean).join(' · ') },
    {
      label: 'Audio',
      value: c.probeState === 'ok' ? audioValue(c) : '',
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
          v-if="!isImage"
          :color="tier.color"
          variant="soft"
          size="md"
          icon="i-lucide-gauge"
          :label="tier.label"
        />
        <UBadge v-if="resolution" color="neutral" variant="subtle" size="md" :label="resolution" />
        <UBadge v-if="codec" color="neutral" variant="subtle" size="md" :label="codec" />
        <UBadge
          v-if="format"
          color="neutral"
          variant="subtle"
          size="md"
          icon="i-lucide-image"
          :label="format"
        />
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

      <!-- Follows the format switch in the trim row: what the file will hold,
           where it lands and what it will be, for the format Export is set to.
           Lifted on the brand tint: the one section about what is going to
           happen, so it reads before the facts below it. -->
      <section v-if="editing" class="export-card">
        <h4 class="export-head">
          <UIcon :name="exportIcon" class="export-icon" />
          {{ exportHeading }}
        </h4>
        <p class="export-range mono">{{ rangeLine }}</p>
        <p class="path export-path" :title="destination">{{ destination }}</p>
        <p class="note export-note">{{ exportNote }}</p>
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

    <!-- Two lines in either mode: the primary action (or, while trimming, the
         way out — the export itself is in the trim row), then Share with the
         two ways a clip leaves the app and a small Delete kept apart in red. -->
    <footer class="actions">
      <UButton
        v-if="!isImage"
        :icon="editing ? 'i-lucide-x' : 'i-lucide-scissors'"
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
        <UDropdownMenu
          :items="shareItems"
          :content="{ side: 'top', align: 'start' }"
          :ui="{ content: 'min-w-80' }"
        >
          <!-- Fills the row like the button above it, with icon, word and
               chevron kept together in the middle (`block` alone would send the
               chevron to the far edge and make it read as a select). -->
          <UButton
            class="share"
            icon="i-lucide-share-2"
            trailing-icon="i-lucide-chevron-down"
            label="Share"
            color="neutral"
            variant="subtle"
            block
            :ui="{ trailingIcon: 'ms-0' }"
            :loading="pendingAction?.kind === 'copy-file'"
            :disabled="busy"
            aria-label="Share: copy the file, or upload it to YouTube"
          />
        </UDropdownMenu>
        <!-- Ends the row, bordered in red and a step apart: reachable and
             unmistakable, never under a pointer aimed at Share. -->
        <UTooltip text="Delete · moves the file to the Recycle Bin">
          <UButton
            class="danger"
            icon="i-lucide-trash-2"
            color="error"
            variant="subtle"
            square
            aria-label="Delete: moves the file to the Recycle Bin"
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

/* The export block while trimming: brand tint and full-strength text, where
   every other section is a quiet table of facts. */
.export-card {
  padding: var(--s-4);
  border-radius: var(--r-md);
  background: var(--primary-soft);
  box-shadow: inset 0 0 0 1px var(--border-active);
}
.export-head {
  display: flex;
  align-items: center;
  gap: var(--s-2);
  color: var(--fg-strong);
}
.export-icon {
  flex: none;
  width: 18px;
  height: 18px;
  color: var(--secondary);
}
.export-range {
  margin: 0 0 var(--s-3);
  font-size: var(--text-sm);
  color: var(--fg);
}
.export-path {
  background: color-mix(in srgb, var(--bg-0) 75%, transparent);
  color: var(--fg);
}
.export-note {
  margin-top: var(--s-3);
  font-size: var(--text-base);
  color: var(--fg);
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
/* Share takes the row, Delete ends it: the same full width as the line above. */
.actions-row {
  display: flex;
  align-items: center;
  gap: var(--s-2);
}
.actions-row .share {
  flex: 1;
  min-width: 0;
}
.actions-row .danger {
  margin-left: var(--s-2);
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
</style>
