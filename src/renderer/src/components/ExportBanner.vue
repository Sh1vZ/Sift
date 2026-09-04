<script setup lang="ts">
import { computed } from 'vue'
import type { ExportJob } from '@shared/types'
import Icon from './Icon.vue'
import { cancelExport, dismissExport } from '@/composables/useExports'
import { getClip } from '@/composables/useLibrary'
import { openResult } from '@/composables/useSearch'

/**
 * An export of the open recording, laid over the top edge of the player from
 * the moment it is queued until it is done or waved away. Before this the only
 * sign that Export had done anything was a toast and the sidebar count; the
 * stage is where the user is looking. Same footprint as the upload banner.
 */
const props = defineProps<{ job: ExportJob }>()

const pct = computed(() => Math.round(props.job.progress * 100))
const live = computed(() => props.job.state === 'queued' || props.job.state === 'running')
const file = computed(() => `${props.job.name}${props.job.ext}`)

// Every state spelled out on purpose: a `default` arm would render the next
// ExportState as the wrong words instead of failing to build.
const title = computed(() => {
  switch (props.job.state) {
    case 'queued':
      return 'Waiting to export…'
    case 'running':
      return `Exporting ${file.value} · ${pct.value}%`
    case 'done':
      return 'Clip exported'
    case 'failed':
      return 'Export failed'
    case 'cancelled':
      return 'Export cancelled'
  }
})

const detail = computed(() => {
  const j = props.job
  switch (j.state) {
    case 'queued':
      return 'Another export is ahead of this one.'
    case 'running':
      return 'Stream copy — the recording itself is never touched.'
    case 'done':
      return `${file.value} · ${j.game}`
    case 'failed':
      return j.error || 'ffmpeg reported an error.'
    case 'cancelled':
      return ''
  }
})

const icon = computed(() => {
  switch (props.job.state) {
    case 'queued':
    case 'running':
      return 'loader'
    case 'done':
      return 'check'
    case 'failed':
      return 'alert'
    case 'cancelled':
      return 'x'
  }
})

/** Opens the exported clip in place; the toast offers the same route. */
function view(): void {
  const clip = props.job.clipId ? getClip(props.job.clipId) : undefined
  if (clip) void openResult(clip)
}
</script>

<template>
  <div class="banner" :class="`is-${job.state}`" role="status" @click.stop @dblclick.stop>
    <Icon
      :name="icon"
      :size="18"
      :stroke="1.9"
      class="banner-icon"
      :class="{ spin: job.state === 'running' }"
    />
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
      @click="cancelExport(job.id)"
    />
    <UButton
      v-else-if="job.state === 'done' && job.clipId"
      icon="i-lucide-arrow-right"
      label="View clip"
      color="primary"
      variant="subtle"
      size="sm"
      @click="view"
    />
    <UButton
      v-if="!live"
      icon="i-lucide-x"
      color="neutral"
      variant="ghost"
      size="sm"
      square
      aria-label="Dismiss"
      @click="dismissExport(job.id)"
    />
    <UProgress
      v-if="live"
      class="bar"
      :model-value="job.state === 'running' ? pct : null"
      size="xs"
      color="primary"
      :aria-label="title"
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
  background: linear-gradient(
    180deg,
    color-mix(in srgb, var(--scrim) 94%, transparent),
    color-mix(in srgb, var(--scrim) 78%, transparent)
  );
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
