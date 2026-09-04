<script setup lang="ts">
import { computed } from 'vue'
import type { Clip } from '@shared/types'
import {
  clipsFolder,
  copyClipFile,
  copyClipPath,
  copyYouTubeLink,
  getClip,
  openYouTube,
  pendingByClip,
  removeFromYouTube,
  revealClip,
} from '@/composables/useLibrary'
import { cancelUpload, progressText, uploadByClip } from '@/composables/useUploads'
import { youtubeUrl } from '@shared/youtube'
import {
  formatBytes,
  formatDuration,
  formatFull,
  formatResolution,
  formatTimecode,
} from '@/utils/format'
import { bitrate, formatBitrate, qualityTier } from '@/utils/quality'

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
const emit = defineEmits<{ close: []; rename: []; remove: []; edit: []; source: []; upload: [] }>()

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
const folder = computed(() => {
  const i = Math.max(props.clip.path.lastIndexOf('/'), props.clip.path.lastIndexOf('\\'))
  return i > 0 ? props.clip.path.slice(0, i) : props.clip.path
})

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
  if (u?.state === 'uploading') return `Cancel upload · ${progressText(u)}`
  if (u?.state === 'queued') return 'Cancel · waiting to upload'
  return props.clip.youtubeId ? 'Upload to YouTube again' : 'Upload to YouTube'
})

/** While a job is live the same button cancels it; otherwise it opens the upload form. */
function onUploadButton(): void {
  const u = upload.value
  if (uploading.value && u) void cancelUpload(u.id)
  else emit('upload')
}
const videoUrl = computed(() => (props.clip.youtubeId ? youtubeUrl(props.clip.youtubeId) : ''))
const sourceClip = computed(() => (props.clip.sourceId ? getClip(props.clip.sourceId) : undefined))
const destination = computed(
  () => `${clipsFolder.value?.name ?? 'Sift Clips'}\\${props.clip.game}\\${props.exportName}`,
)

const videoRows = computed<Row[]>(() => {
  const c = props.clip
  return [
    { label: 'Duration', value: c.duration ? formatDuration(c.duration) : '', mono: true },
    {
      label: 'Dimensions',
      value: c.width && c.height ? `${c.width} × ${c.height}` : '',
      mono: true,
    },
    { label: 'Frame rate', value: c.fps ? `${Math.round(c.fps)} fps` : '', mono: true },
    { label: 'Codec', value: codec.value },
    { label: 'Bitrate', value: formatBitrate(bitrate(c)), mono: true },
    {
      label: 'Audio',
      value: c.probeState === 'ok' ? (c.hasAudio ? 'Included' : c.muted ? 'Removed' : 'None') : '',
    },
  ]
})

const fileRows = computed<Row[]>(() => {
  const c = props.clip
  return [
    { label: 'Size', value: formatBytes(c.size), mono: true },
    { label: 'Format', value: c.ext.replace('.', '').toUpperCase() },
    { label: 'Game', value: c.game },
    { label: 'Recorded', value: formatFull(c.recordedAtMs) },
    { label: 'Modified', value: formatFull(c.mtimeMs) },
  ]
})

const sourceRows = computed<Row[]>(() => {
  const c = props.clip
  return [
    { label: 'Cut from', value: sourceClip.value?.title ?? 'No longer in the library' },
    {
      label: 'Trimmed',
      value: `${formatTimecode(c.trimStart)} – ${formatTimecode(c.trimEnd)}`,
      mono: true,
    },
    { label: 'Exported', value: c.createdAtMs ? formatFull(c.createdAtMs) : '' },
  ]
})
</script>

<template>
  <aside class="details" aria-label="Clip details">
    <header class="head">
      <h3 class="truncate" :title="clip.title">{{ clip.title }}</h3>
      <UTooltip text="Hide details" :kbds="['I']">
        <UButton
          icon="i-lucide-panel-right-close"
          color="neutral"
          variant="ghost"
          square
          size="md"
          aria-label="Hide details"
          @click="$emit('close')"
        />
      </UTooltip>
    </header>

    <div class="scroll">
      <p class="filename" :title="clip.name + clip.ext">{{ clip.name + clip.ext }}</p>

      <div class="chips">
        <UBadge
          :color="tier.color"
          variant="soft"
          size="sm"
          icon="i-lucide-gauge"
          :label="tier.label"
        />
        <UBadge v-if="resolution" color="neutral" variant="subtle" size="sm" :label="resolution" />
        <UBadge v-if="codec" color="neutral" variant="subtle" size="sm" :label="codec" />
        <UBadge
          v-if="clip.youtubeId"
          color="error"
          variant="subtle"
          size="sm"
          icon="i-lucide-youtube"
          label="On YouTube"
        />
        <UBadge
          v-if="isExport"
          color="primary"
          variant="subtle"
          size="sm"
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
        <h4>Video</h4>
        <dl class="rows">
          <div v-for="row in videoRows" :key="row.label" class="row">
            <dt>{{ row.label }}</dt>
            <dd v-if="row.value" :class="{ mono: row.mono }">{{ row.value }}</dd>
            <USkeleton v-else-if="pending" class="h-3 w-16" />
            <dd v-else class="empty">—</dd>
          </div>
        </dl>
      </section>

      <section>
        <h4>File</h4>
        <dl class="rows">
          <div v-for="row in fileRows" :key="row.label" class="row">
            <dt>{{ row.label }}</dt>
            <dd v-if="row.value" :class="{ mono: row.mono }" :title="row.value">{{ row.value }}</dd>
            <dd v-else class="empty">—</dd>
          </div>
        </dl>
      </section>

      <section v-if="isExport">
        <h4>Source</h4>
        <dl class="rows">
          <div v-for="row in sourceRows" :key="row.label" class="row">
            <dt>{{ row.label }}</dt>
            <dd v-if="row.value" :class="{ mono: row.mono }" :title="row.value">{{ row.value }}</dd>
            <dd v-else class="empty">—</dd>
          </div>
        </dl>
        <UButton
          class="source-btn"
          icon="i-lucide-link"
          label="Open source recording"
          color="neutral"
          variant="subtle"
          size="md"
          block
          :disabled="!sourceClip"
          @click="$emit('source')"
        />
      </section>

      <section v-if="videoUrl">
        <h4>YouTube</h4>
        <p class="path" :title="videoUrl">{{ videoUrl }}</p>
        <div class="yt-actions">
          <UButton
            icon="i-lucide-external-link"
            label="Open"
            color="neutral"
            variant="subtle"
            size="md"
            block
            @click="openYouTube(clip)"
          />
          <UButton
            icon="i-lucide-link-2"
            label="Copy link"
            color="neutral"
            variant="subtle"
            size="md"
            block
            @click="copyYouTubeLink(clip)"
          />
          <UButton
            class="yt-remove"
            icon="i-lucide-cloud-off"
            label="Remove from YouTube"
            color="error"
            variant="subtle"
            size="md"
            block
            :loading="pendingAction?.kind === 'remove-youtube'"
            :disabled="uploading || busy"
            @click="removeFromYouTube(clip)"
          />
        </div>
      </section>

      <section>
        <h4>Location</h4>
        <!-- Selectable: a path is something you copy out by hand as often as
             you copy it with the button below. -->
        <p class="path" :title="clip.path">{{ folder }}</p>
      </section>
    </div>

    <footer class="actions">
      <UButton
        class="wide"
        icon="i-lucide-scissors"
        :label="editing ? 'Leave edit mode' : 'Trim & export'"
        :color="editing ? 'neutral' : 'primary'"
        :variant="editing ? 'subtle' : 'solid'"
        size="md"
        block
        :disabled="!canEdit"
        @click="$emit('edit')"
      />
      <UButton
        class="wide"
        :icon="uploading ? 'i-lucide-x' : 'i-lucide-youtube'"
        :color="uploading ? 'error' : 'neutral'"
        :label="uploadLabel"
        variant="subtle"
        size="md"
        block
        :disabled="clip.probeState !== 'ok' || busy"
        @click="onUploadButton"
      />
      <UButton
        class="wide"
        icon="i-lucide-clipboard-copy"
        label="Copy file"
        color="neutral"
        variant="subtle"
        size="md"
        block
        :loading="pendingAction?.kind === 'copy-file'"
        :disabled="busy"
        @click="copyClipFile(clip)"
      />
      <UButton
        icon="i-lucide-folder-open"
        label="Explorer"
        color="neutral"
        variant="subtle"
        size="md"
        block
        @click="revealClip(clip)"
      />
      <UButton
        icon="i-lucide-copy"
        label="Copy path"
        color="neutral"
        variant="subtle"
        size="md"
        block
        @click="copyClipPath(clip)"
      />
      <UButton
        class="wide"
        icon="i-lucide-pencil"
        label="Rename"
        color="neutral"
        variant="subtle"
        size="md"
        block
        :loading="pendingAction?.kind === 'rename'"
        :disabled="busy"
        @click="$emit('rename')"
      />
      <UButton
        class="wide danger"
        icon="i-lucide-trash-2"
        label="Delete"
        color="error"
        variant="subtle"
        size="md"
        block
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
  align-items: center;
  gap: var(--s-2);
  padding: var(--s-3) var(--s-3) var(--s-3) var(--s-5);
  border-bottom: 1px solid var(--border);
}
.head h3 {
  flex: 1;
  min-width: 0;
  font-size: var(--text-md);
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
.filename {
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  line-height: 1.5;
  color: var(--fg-muted);
  word-break: break-all;
  user-select: text;
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
  font-size: var(--text-xs);
  font-weight: 600;
  letter-spacing: 0.09em;
  text-transform: uppercase;
  color: var(--fg-dim);
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
  min-height: 34px;
  padding: var(--s-2) var(--s-3);
}
.row + .row {
  border-top: 1px solid var(--border);
}
.row dt {
  flex: none;
  font-size: var(--text-sm);
  color: var(--fg-muted);
}
.row dd {
  margin: 0;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: var(--text-sm);
  color: var(--fg);
  user-select: text;
}
.row dd.empty {
  color: var(--fg-dim);
}
.path {
  padding: var(--s-3);
  border-radius: var(--r-md);
  background: var(--bg-2);
  box-shadow: inset 0 0 0 1px var(--border);
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  line-height: 1.6;
  color: var(--fg-muted);
  word-break: break-all;
  user-select: text;
}
.note {
  margin-top: var(--s-2);
  font-size: var(--text-xs);
  line-height: 1.5;
  color: var(--fg-muted);
}
.source-btn {
  margin-top: var(--s-2);
}
.yt-actions {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--s-2);
  margin-top: var(--s-2);
}
/* Destructive, so it spans the row and sits apart from Open / Copy link. */
.yt-remove {
  grid-column: 1 / -1;
}
.actions {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--s-2);
  padding: var(--s-4) var(--s-5);
  border-top: 1px solid var(--border);
  background: var(--bg-1);
}
.actions .wide {
  grid-column: 1 / -1;
}
/* The destructive action ends the list and keeps its distance, so it is never
   the button you hit reaching for Rename. */
.actions .danger {
  margin-top: var(--s-2);
}
</style>
