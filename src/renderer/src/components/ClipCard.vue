<script setup lang="ts">
import { computed, ref } from 'vue'
import type { Clip, ExportJob } from '@shared/types'
import Icon from './Icon.vue'
import { now, settings } from '@/composables/useLibrary'
import { clamp, formatBytes, formatDuration, formatRelative, formatResolution } from '@/utils/format'

const props = withDefaults(
  defineProps<{
    clip: Clip
    /** `export` cards say which game they came from and when they were exported. */
    variant?: 'recording' | 'export'
    /** An export still in flight: the card is a progress placeholder, not something you can open. */
    job?: ExportJob
  }>(),
  { variant: 'recording', job: undefined }
)
const emit = defineEmits<{ open: [clip: Clip, rect: DOMRect] }>()

const api = window.api
const thumbEl = ref<HTMLElement | null>(null)
const hovering = ref(false)
const frame = ref(0)
const posterLoaded = ref(false)
const spriteLoaded = ref(false)

const poster = computed(() => (props.clip.thumb ? api.thumbUrl(props.clip.thumb) : ''))
const sprite = computed(() => (props.clip.sprite ? api.thumbUrl(props.clip.sprite) : ''))
const frames = computed(() => props.clip.spriteFrames)
const canScrub = computed(() => !props.job && settings.value.hoverPreview && Boolean(sprite.value) && frames.value > 1)
const resolution = computed(() => formatResolution(props.clip.width, props.clip.height, props.clip.fps))
const when = computed(() =>
  formatRelative(props.variant === 'export' ? props.clip.createdAtMs || props.clip.recordedAtMs : props.clip.recordedAtMs, now.value)
)

const jobPct = computed(() => Math.round((props.job?.progress ?? 0) * 100))
const jobLabel = computed(() => {
  switch (props.job?.state) {
    case 'queued':
      return 'Waiting…'
    case 'running':
      return `Exporting · ${jobPct.value}%`
    case 'failed':
      return 'Export failed'
    case 'cancelled':
      return 'Cancelled'
    default:
      return ''
  }
})
const jobFailed = computed(() => props.job?.state === 'failed' || props.job?.state === 'cancelled')

function onMove(e: MouseEvent): void {
  if (!canScrub.value || !thumbEl.value) return
  const r = thumbEl.value.getBoundingClientRect()
  const pct = clamp((e.clientX - r.left) / r.width, 0, 0.9999)
  frame.value = Math.floor(pct * frames.value)
}

function leave(): void {
  hovering.value = false
  frame.value = 0
}

function open(): void {
  if (props.job) return
  const rect = thumbEl.value?.getBoundingClientRect()
  if (rect) emit('open', props.clip, rect)
}
</script>

<template>
  <article
    class="clip-card"
    :class="{ 'is-job': job }"
    :data-clip-id="clip.id"
    :tabindex="job ? -1 : 0"
    :role="job ? undefined : 'button'"
    :aria-label="job ? `${jobLabel} ${clip.title}` : `Play ${clip.title}`"
    :aria-busy="job ? !jobFailed : undefined"
    @click="open"
    @keydown.enter.prevent="open"
    @keydown.space.prevent="open"
    @mouseenter="hovering = true"
    @mouseleave="leave"
    @mousemove="onMove"
  >
    <div class="inner">
      <div ref="thumbEl" class="thumb">
        <img
          v-if="poster"
          class="poster"
          :class="{ 'is-loaded': posterLoaded }"
          :src="poster"
          alt=""
          loading="lazy"
          decoding="async"
          @load="posterLoaded = true"
        />
        <Transition name="fade">
          <div v-if="!poster || !posterLoaded" class="placeholder">
            <USkeleton v-if="clip.probeState === 'pending'" class="placeholder-skeleton" />
            <Icon :name="clip.probeState === 'failed' ? 'video-off' : 'film'" :size="26" :stroke="1.6" />
          </div>
        </Transition>

        <div v-if="hovering && canScrub" class="scrub" :class="{ 'is-loaded': spriteLoaded }">
          <img
            :src="sprite"
            alt=""
            decoding="async"
            :style="{
              width: `${frames * 100}%`,
              transform: `translate3d(${(-frame * 100) / frames}%, 0, 0)`
            }"
            @load="spriteLoaded = true"
          />
          <div class="scrub-bar" :style="{ width: `${((frame + 0.5) / frames) * 100}%` }" />
        </div>

        <!-- Progress veil for an export in flight: the source poster sits
             behind it so the card already looks like the clip it will become. -->
        <div v-if="job" class="job-veil" :class="{ 'is-failed': jobFailed }">
          <Icon :name="jobFailed ? 'alert' : 'scissors'" :size="22" :stroke="1.8" />
          <span class="job-label">{{ jobLabel }}</span>
          <UProgress
            v-if="!jobFailed"
            class="job-progress"
            :model-value="job.state === 'running' ? jobPct : null"
            size="xs"
            color="primary"
            :aria-label="`Export progress ${jobPct}%`"
          />
        </div>

        <UBadge v-if="resolution && !job" class="badge res" size="sm" :label="resolution" />
        <UBadge v-if="clip.duration" class="badge duration mono" size="sm" :label="formatDuration(clip.duration)" />

        <span v-if="!job" class="play-hint" aria-hidden="true">
          <Icon name="play" :size="20" />
        </span>
      </div>

      <div class="meta">
        <h3 class="title truncate" :title="clip.name + clip.ext">{{ clip.title }}</h3>
        <p class="sub truncate">
          <template v-if="variant === 'export'">
            <span class="game truncate">{{ clip.game }}</span>
            <span class="dot">·</span>
          </template>
          <span>{{ job ? jobLabel : when }}</span>
          <template v-if="clip.size">
            <span class="dot">·</span>
            <span>{{ formatBytes(clip.size) }}</span>
          </template>
        </p>
      </div>
    </div>
  </article>
</template>

<style scoped>
.clip-card {
  display: block;
  border-radius: var(--r-lg);
  cursor: pointer;
  outline-offset: 3px;
}
.clip-card.is-job {
  cursor: default;
}
.inner {
  border-radius: var(--r-lg);
  transition:
    transform var(--dur) var(--ease-out),
    box-shadow var(--dur) var(--ease-out);
}
/* Hover and keyboard focus get the identical treatment - the ring lights up, the
   card lifts a little and casts a real shadow under the violet bloom. */
.clip-card:not(.is-job):hover .inner,
.clip-card:focus-visible .inner {
  transform: translateY(-2px);
  box-shadow: var(--glow-primary), var(--shadow-lg);
}
/* Press settles the card back down, so a click reads as pushing it. */
.clip-card:not(.is-job):active .inner {
  transform: translateY(0);
  transition-duration: var(--dur-fast);
}
.thumb {
  position: relative;
  aspect-ratio: 16 / 9;
  border-radius: var(--r-lg);
  overflow: hidden;
  background: var(--bg-3);
  box-shadow: inset 0 0 0 1px var(--border);
  transform: translateZ(0);
  transition: box-shadow var(--dur) var(--ease-out);
}
.clip-card:not(.is-job):hover .thumb,
.clip-card:focus-visible .thumb {
  box-shadow: inset 0 0 0 1px var(--border-active);
}
.poster {
  width: 100%;
  height: 100%;
  object-fit: cover;
  opacity: 0;
  transition:
    opacity var(--dur-slow) var(--ease-out),
    transform var(--dur-slow) var(--ease-out);
}
.poster.is-loaded {
  opacity: 1;
}
/* The image inside the clipped thumb, never the card box - nothing reflows and
   no neighbour moves. */
.clip-card:not(.is-job):hover .poster,
.clip-card:focus-visible .poster {
  transform: scale(1.03);
}
.placeholder {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--fg-dim);
}
.placeholder-skeleton {
  position: absolute;
  inset: 0;
  border-radius: 0;
  background: var(--bg-3);
}
.scrub {
  position: absolute;
  inset: 0;
  overflow: hidden;
  opacity: 0;
  transition: opacity var(--dur-fast) var(--ease-out);
}
.scrub.is-loaded {
  opacity: 1;
}
.scrub img {
  height: 100%;
  max-width: none;
  object-fit: cover;
  will-change: transform;
}
.scrub-bar {
  position: absolute;
  left: 0;
  bottom: 0;
  height: 3px;
  background: linear-gradient(90deg, var(--secondary), var(--accent));
  box-shadow: 0 0 10px color-mix(in srgb, var(--accent) 60%, transparent);
}
.job-veil {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--s-2);
  padding: var(--s-4) var(--s-6);
  color: var(--secondary);
  background: rgba(7, 7, 18, 0.72);
  backdrop-filter: blur(3px);
}
.job-veil.is-failed {
  color: var(--warning);
}
.job-label {
  font-family: var(--font-heading);
  font-size: var(--text-sm);
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--fg);
}
.job-progress {
  width: 60%;
}
.badge {
  position: absolute;
  bottom: 8px;
  right: 8px;
  background: rgba(10, 10, 24, 0.82);
  color: #f1f5f9;
  font-family: var(--font-heading);
  font-weight: 600;
  letter-spacing: 0.03em;
  backdrop-filter: blur(4px);
}
/* Quality reads at rest: it is how you tell two recordings of the same match
   apart, so it must not depend on hover. */
.badge.res {
  top: 8px;
  left: 8px;
  bottom: auto;
  right: auto;
  color: var(--secondary);
}
.play-hint {
  position: absolute;
  left: 50%;
  top: 50%;
  width: 52px;
  height: 52px;
  margin: -26px 0 0 -26px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding-left: 3px;
  border-radius: 50%;
  color: var(--on-primary);
  background: linear-gradient(135deg, var(--primary-hover), var(--primary));
  box-shadow: 0 10px 30px -6px color-mix(in srgb, var(--primary) 90%, transparent);
  opacity: 0;
  transform: scale(0.6);
  transition:
    opacity var(--dur) var(--ease-out),
    transform var(--dur-slow) var(--ease-spring);
}
.clip-card:hover .play-hint,
.clip-card:focus-visible .play-hint {
  opacity: 1;
  transform: scale(1);
}
.clip-card:hover .scrub.is-loaded ~ .play-hint {
  opacity: 0;
  transform: scale(0.6);
}
/* Inset on every side: the hover ring sits on the card's edge, so the title and
   the date line need room before it. Keep in step with META_H in useVirtualGrid. */
.meta {
  padding: 12px 10px;
}
.title {
  font-size: var(--text-md);
  font-weight: 600;
  color: var(--fg);
  transition: color var(--dur-fast) var(--ease-out);
}
.clip-card:not(.is-job):hover .title,
.clip-card:focus-visible .title {
  color: var(--secondary);
}
.sub {
  display: flex;
  gap: 5px;
  margin-top: 3px;
  font-size: var(--text-sm);
  color: var(--fg-muted);
}
.game {
  max-width: 45%;
  color: var(--secondary);
}
.dot {
  color: var(--fg-dim);
}
</style>
