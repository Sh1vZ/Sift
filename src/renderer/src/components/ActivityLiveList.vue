<script setup lang="ts">
import type { ExportJob } from '@shared/types'
import type { UploadJob } from '@shared/youtube'
import { activityItems } from '@/composables/useActivity'
import { cancelExport, dismissExport } from '@/composables/useExports'
import { getClip, openYouTube } from '@/composables/useLibrary'
import {
  cancelUpload,
  checkUploadNow,
  dismissUpload,
  progressText,
  stageText,
} from '@/composables/useUploads'

/**
 * Every job main is running, in one list: exports, uploads and the scan. The
 * cards and the player show the same jobs in place; this is where you see them
 * together and stop one without hunting for its card. Shared by the sidebar
 * popover and the Activity page, so the two never drift apart.
 */
const liveExport = (j: ExportJob): boolean => j.state === 'queued' || j.state === 'running'
const liveUpload = (j: UploadJob): boolean => j.state === 'queued' || j.state === 'uploading'
/** Sift has stopped asking, so the row offers the question as a button instead. */
const stalled = (j: UploadJob): boolean => j.state === 'processing' && j.checksStopped

/**
 * Determinate only where there is a real number to show: the bytes Sift sent,
 * or the parts YouTube says it has done. It often reports neither, and an
 * indeterminate bar is honest where a 0% one is not.
 */
function barValue(j: UploadJob): number | null {
  if (j.state === 'uploading') return Math.round(j.progress * 100)
  if (j.state === 'processing' && j.stageProgress >= 0) return Math.round(j.stageProgress * 100)
  return null
}

function exportLine(j: ExportJob): string {
  switch (j.state) {
    case 'queued':
      return 'Waiting…'
    case 'running':
      return `Exporting · ${Math.round(j.progress * 100)}%`
    case 'done':
      return 'Exported'
    case 'failed':
      return j.error || 'Export failed'
    default:
      return 'Cancelled'
  }
}

// Every arm is spelled out: a `default` here would quietly render the next
// UploadState as "Cancelled" instead of failing to compile.
function uploadLine(j: UploadJob): string {
  switch (j.state) {
    case 'queued':
      return 'Waiting to upload…'
    case 'uploading':
      return `Uploading · ${progressText(j)}`
    case 'processing':
      return stageText(j)
    case 'done':
      return stageText(j) || (j.accountLabel ? `Uploaded · via ${j.accountLabel}` : 'Uploaded')
    case 'failed':
      return j.error || 'Upload failed'
    case 'cancelled':
      return 'Cancelled'
  }
}

function openUploaded(j: UploadJob): void {
  const clip = getClip(j.clipId)
  if (clip) void openYouTube(clip)
}
</script>

<template>
  <UEmpty
    v-if="!activityItems.length"
    class="empty"
    icon="i-lucide-moon"
    title="Nothing running"
    description="Exports, uploads and scans show up here while they work."
    variant="subtle"
    size="sm"
  />

  <ul v-else class="list">
    <li v-for="item in activityItems" :key="item.id" class="item">
      <template v-if="item.kind === 'export'">
        <UIcon
          name="i-lucide-scissors"
          class="item-icon"
          :class="{ 'is-failed': item.job.state === 'failed' }"
        />
        <div class="text">
          <p class="title truncate" :title="item.job.name + item.job.ext">
            {{ item.job.name }}{{ item.job.ext }}
          </p>
          <p class="line truncate">{{ exportLine(item.job) }}</p>
          <UProgress
            v-if="liveExport(item.job)"
            class="bar"
            size="xs"
            color="primary"
            :model-value="item.job.state === 'running' ? Math.round(item.job.progress * 100) : null"
            :aria-label="exportLine(item.job)"
          />
        </div>
        <UButton
          v-if="liveExport(item.job)"
          label="Cancel"
          color="error"
          variant="ghost"
          size="sm"
          @click="cancelExport(item.job.id)"
        />
        <UButton
          v-else
          icon="i-lucide-x"
          color="neutral"
          variant="ghost"
          size="sm"
          square
          aria-label="Dismiss"
          @click="dismissExport(item.job.id)"
        />
      </template>

      <template v-else-if="item.kind === 'upload'">
        <UIcon
          name="i-lucide-youtube"
          class="item-icon"
          :class="{
            'is-failed': item.job.state === 'failed',
            'is-done': item.job.state === 'done',
          }"
        />
        <div class="text">
          <p class="title truncate" :title="item.job.title">{{ item.job.title }}</p>
          <p class="line truncate">{{ uploadLine(item.job) }}</p>
          <UProgress
            v-if="liveUpload(item.job) || item.job.state === 'processing'"
            class="bar"
            size="xs"
            color="primary"
            :model-value="barValue(item.job)"
            :aria-label="uploadLine(item.job)"
          />
        </div>
        <UButton
          v-if="liveUpload(item.job)"
          label="Cancel"
          color="error"
          variant="ghost"
          size="sm"
          @click="cancelUpload(item.job.id)"
        />
        <template v-else>
          <UTooltip v-if="stalled(item.job)" text="Check status now">
            <UButton
              icon="i-lucide-refresh-cw"
              color="neutral"
              variant="ghost"
              size="sm"
              square
              aria-label="Check status now"
              @click="checkUploadNow(item.job)"
            />
          </UTooltip>
          <UTooltip v-if="item.job.videoId" text="Open on YouTube">
            <UButton
              icon="i-lucide-external-link"
              color="neutral"
              variant="ghost"
              size="sm"
              square
              aria-label="Open on YouTube"
              @click="openUploaded(item.job)"
            />
          </UTooltip>
          <UButton
            icon="i-lucide-x"
            color="neutral"
            variant="ghost"
            size="sm"
            square
            :aria-label="item.job.state === 'processing' ? 'Stop checking' : 'Dismiss'"
            @click="dismissUpload(item.job.id)"
          />
        </template>
      </template>

      <template v-else>
        <UIcon name="i-lucide-radar" class="item-icon animate-spin" />
        <div class="text">
          <p class="title truncate">
            {{ item.scan.active ? `Scanning ${item.scan.folder}` : 'Generating previews' }}
          </p>
          <p class="line truncate">
            {{ item.scan.found }} found · {{ item.scan.pending }} left · {{ item.scan.done }} done
          </p>
          <UProgress class="bar" size="xs" color="primary" :model-value="null" aria-label="Scan" />
        </div>
      </template>
    </li>
  </ul>
</template>

<style scoped>
.empty {
  padding: var(--s-5) var(--s-4);
}
.list {
  list-style: none;
  margin: 0;
  padding: 0;
}
.item {
  display: flex;
  align-items: center;
  gap: var(--s-3);
  padding: var(--s-3) var(--s-4);
}
.item + .item {
  border-top: 1px solid var(--border);
}
.item-icon {
  flex: none;
  width: 20px;
  height: 20px;
  color: var(--secondary);
}
.item-icon.is-done {
  color: var(--success);
}
.item-icon.is-failed {
  color: var(--warning);
}
.text {
  flex: 1;
  min-width: 0;
}
.title {
  font-size: var(--text-base);
  font-weight: 600;
  color: var(--fg);
}
.line {
  margin-top: 1px;
  font-size: var(--text-sm);
  color: var(--fg-muted);
}
.bar {
  margin-top: var(--s-2);
}
</style>
