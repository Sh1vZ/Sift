<script setup lang="ts">
import { computed } from 'vue'
import type { Clip } from '@shared/types'
import type { UploadJob } from '@shared/youtube'
import Icon from '../Icon.vue'
import { openYouTube } from '@/composables/useLibrary'
import { cancelUpload, dismissUpload, formatRate } from '@/composables/useUploads'
import { formatBytes } from '@/utils/format'

/**
 * The upload's progress, laid over the top edge of the player while the clip
 * is on its way to YouTube. Lives on the stage rather than in the chrome so it
 * stays put when the controls fade, and stops clicks from reaching the video.
 */
const props = defineProps<{ job: UploadJob; clip: Clip }>()

const pct = computed(() => Math.round(props.job.progress * 100))
const live = computed(() => props.job.state === 'queued' || props.job.state === 'uploading')

/** "12 s left" from the smoothed rate main reports; blank until there is a rate. */
const eta = computed(() => {
  const j = props.job
  if (j.state !== 'uploading' || !j.bytesPerSecond || !j.size) return ''
  const s = Math.max(1, Math.round((j.size - j.bytesSent) / j.bytesPerSecond))
  if (s < 60) return `${s} s left`
  const m = Math.floor(s / 60)
  return `${m} min ${s % 60} s left`
})

const title = computed(() => {
  switch (props.job.state) {
    case 'queued':
      return 'Waiting to upload to YouTube'
    case 'uploading':
      return `Uploading to YouTube · ${pct.value}%`
    case 'done':
      return 'Uploaded to YouTube'
    case 'failed':
      return 'Upload failed'
    default:
      return 'Upload cancelled'
  }
})

const detail = computed(() => {
  const j = props.job
  switch (j.state) {
    case 'uploading':
      return [
        `${formatBytes(j.bytesSent)} of ${formatBytes(j.size)}`,
        formatRate(j.bytesPerSecond),
        eta.value,
      ]
        .filter(Boolean)
        .join(' · ')
    case 'queued':
      return 'Another upload is ahead of this one.'
    case 'done':
      return j.channelTitle ? `On ${j.channelTitle}` : j.accountLabel
    case 'failed':
      return j.error
    default:
      return ''
  }
})

const icon = computed(() => {
  switch (props.job.state) {
    case 'done':
      return 'check'
    case 'failed':
      return 'alert'
    case 'cancelled':
      return 'x'
    default:
      return 'cloud-upload'
  }
})
</script>

<template>
  <div class="banner" :class="`is-${job.state}`" role="status" @click.stop @dblclick.stop>
    <Icon :name="icon" :size="18" :stroke="1.9" class="banner-icon" />
    <div class="text">
      <p class="title">{{ title }}</p>
      <p v-if="detail" class="detail truncate" :title="detail">{{ detail }}</p>
    </div>
    <UButton
      v-if="live"
      label="Cancel"
      color="neutral"
      variant="subtle"
      size="sm"
      @click="cancelUpload(job.id)"
    />
    <UButton
      v-else-if="job.state === 'done' && clip.youtubeId"
      icon="i-lucide-external-link"
      label="Open"
      color="neutral"
      variant="subtle"
      size="sm"
      @click="openYouTube(clip)"
    />
    <UButton
      v-else
      icon="i-lucide-x"
      color="neutral"
      variant="ghost"
      size="sm"
      square
      aria-label="Dismiss"
      @click="dismissUpload(job.id)"
    />
    <UProgress
      v-if="live"
      class="bar"
      :model-value="job.state === 'uploading' ? pct : null"
      size="xs"
      color="primary"
      :aria-label="`Upload progress ${pct}%`"
    />
  </div>
</template>

<style scoped>
.banner {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  z-index: 3;
  display: flex;
  align-items: center;
  gap: var(--s-3);
  padding: var(--s-3) var(--s-4) calc(var(--s-3) + 3px);
  color: var(--fg);
  background: linear-gradient(180deg, rgba(7, 7, 18, 0.94), rgba(7, 7, 18, 0.78));
  backdrop-filter: blur(6px);
  border-bottom: 1px solid var(--border);
  cursor: default;
}
.banner-icon {
  color: var(--secondary);
}
.is-done .banner-icon {
  color: var(--success);
}
.is-failed .banner-icon,
.is-cancelled .banner-icon {
  color: var(--warning);
}
.text {
  flex: 1;
  min-width: 0;
}
.title {
  font-family: var(--font-heading);
  font-size: var(--text-sm);
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}
.detail {
  margin-top: 1px;
  font-size: var(--text-sm);
  color: var(--fg-muted);
}
/* The bar sits on the banner's bottom edge so the strip and the video share one line. */
.bar {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
}
</style>
