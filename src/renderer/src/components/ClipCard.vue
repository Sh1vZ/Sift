<script setup lang="ts">
import { computed, ref } from 'vue'
import type { Clip } from '@shared/types'
import Icon from './Icon.vue'
import { now, settings } from '@/composables/useLibrary'
import { clamp, formatBytes, formatDuration, formatRelative, formatResolution } from '@/utils/format'

const props = defineProps<{ clip: Clip }>()
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
const canScrub = computed(() => settings.value.hoverPreview && Boolean(sprite.value) && frames.value > 1)
const resolution = computed(() => formatResolution(props.clip.width, props.clip.height, props.clip.fps))
const when = computed(() => formatRelative(props.clip.recordedAtMs, now.value))

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
  const rect = thumbEl.value?.getBoundingClientRect()
  if (rect) emit('open', props.clip, rect)
}
</script>

<template>
  <article
    class="clip-card"
    :data-clip-id="clip.id"
    tabindex="0"
    role="button"
    :aria-label="`Play ${clip.title}`"
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
        <div v-else class="placeholder">
          <USkeleton v-if="clip.probeState === 'pending'" class="placeholder-skeleton" />
          <Icon :name="clip.probeState === 'failed' ? 'video-off' : 'film'" :size="26" :stroke="1.6" />
        </div>

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

        <UBadge v-if="resolution" class="badge res" size="sm" :label="resolution" />
        <UBadge v-if="clip.duration" class="badge duration mono" size="sm" :label="formatDuration(clip.duration)" />

        <span class="play-hint" aria-hidden="true">
          <Icon name="play" :size="20" />
        </span>
      </div>

      <div class="meta">
        <h3 class="title truncate" :title="clip.name + clip.ext">{{ clip.title }}</h3>
        <p class="sub truncate">
          <span>{{ when }}</span>
          <span class="dot">·</span>
          <span>{{ formatBytes(clip.size) }}</span>
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
.inner {
  border-radius: var(--r-lg);
  transition:
    transform var(--dur) var(--ease-out),
    box-shadow var(--dur) var(--ease-out);
}
.clip-card:hover .inner,
.clip-card:focus-visible .inner {
  transform: translateY(-4px);
  box-shadow: var(--glow-primary);
}
.thumb {
  position: relative;
  aspect-ratio: 16 / 9;
  border-radius: var(--r-lg);
  overflow: hidden;
  background: var(--bg-3);
  box-shadow: inset 0 0 0 1px var(--border);
  transform: translateZ(0);
}
.poster {
  width: 100%;
  height: 100%;
  object-fit: cover;
  opacity: 0;
  transition:
    opacity var(--dur-slow) var(--ease-out),
    transform 600ms var(--ease-out);
}
.poster.is-loaded {
  opacity: 1;
}
.clip-card:hover .poster {
  transform: scale(1.04);
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
  box-shadow: 0 0 10px rgba(244, 63, 94, 0.6);
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
  color: #fff;
  background: linear-gradient(135deg, rgba(139, 92, 246, 0.95), rgba(124, 58, 237, 0.95));
  box-shadow: 0 10px 30px -6px rgba(124, 58, 237, 0.9);
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
.meta {
  padding: 10px 4px 0;
}
.title {
  font-size: var(--text-md);
  font-weight: 600;
  color: var(--fg);
}
.sub {
  display: flex;
  gap: 5px;
  margin-top: 3px;
  font-size: var(--text-sm);
  color: var(--fg-muted);
}
.dot {
  color: var(--fg-dim);
}
</style>
