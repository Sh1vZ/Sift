<script setup lang="ts">
import { computed, ref } from 'vue'
import type { Clip, ExportJob } from '@shared/types'
import type { UploadJob } from '@shared/youtube'
import type { ClipMenuItem } from '@/composables/useClipMenu'
import FavouriteButton from './FavouriteButton.vue'
import Icon from './Icon.vue'
import { now, settings, type PendingAction } from '@/composables/useLibrary'
import { progressText } from '@/composables/useUploads'
import {
  clamp,
  formatBytes,
  formatDuration,
  formatRelative,
  formatResolution,
} from '@/utils/format'

const props = withDefaults(
  defineProps<{
    clip: Clip
    /** `export` cards say which game they came from and when they were exported. */
    variant?: 'recording' | 'export'
    /** An export still in flight: the card is a progress placeholder, not something you can open. */
    job?: ExportJob
    /** A YouTube upload of this clip: a progress veil over a card that stays a real, openable clip. */
    upload?: UploadJob
    /** A slow action on this clip (delete, rename, remove from YouTube) still running. */
    pending?: PendingAction
    /** The card's actions, the same list its right-click menu shows. */
    menu?: ClipMenuItem[][]
  }>(),
  { variant: 'recording', job: undefined, upload: undefined, pending: undefined, menu: () => [] },
)
const emit = defineEmits<{
  open: [clip: Clip, rect: DOMRect]
  cancelUpload: [jobId: string]
  cancelJob: [jobId: string]
  dismissJob: [jobId: string]
}>()

const api = window.api
const thumbEl = ref<HTMLElement | null>(null)
const hovering = ref(false)
const menuOpen = ref(false)
const frame = ref(0)
const posterLoaded = ref(false)
const spriteLoaded = ref(false)

const poster = computed(() => (props.clip.thumb ? api.thumbUrl(props.clip.thumb) : ''))
const sprite = computed(() => (props.clip.sprite ? api.thumbUrl(props.clip.sprite) : ''))
const frames = computed(() => props.clip.spriteFrames)
const canScrub = computed(
  () =>
    !props.job &&
    !veil.value &&
    !props.pending &&
    settings.value.hoverPreview &&
    Boolean(sprite.value) &&
    frames.value > 1,
)
const resolution = computed(() =>
  formatResolution(props.clip.width, props.clip.height, props.clip.fps),
)
const when = computed(() =>
  formatRelative(
    props.variant === 'export'
      ? props.clip.createdAtMs || props.clip.recordedAtMs
      : props.clip.recordedAtMs,
    now.value,
  ),
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

interface Veil {
  icon: string
  label: string
  /** Bar value while active; null for an indeterminate bar; undefined for no bar. */
  bar: number | null | undefined
  failed: boolean
  busy: boolean
}

/** What sits over the thumbnail: the export placeholder, or a YouTube upload's state. */
const veil = computed<Veil | null>(() => {
  if (props.job) {
    return {
      icon: jobFailed.value ? 'alert' : 'scissors',
      label: jobLabel.value,
      bar: jobFailed.value ? undefined : props.job.state === 'running' ? jobPct.value : null,
      failed: jobFailed.value,
      busy: !jobFailed.value,
    }
  }
  if (props.pending) {
    return { icon: 'loader', label: props.pending.label, bar: null, failed: false, busy: true }
  }
  const u = props.upload
  if (!u) return null
  // YouTube's own processing can run for an hour. Veiling the card that long
  // would cost the poster, the hover scrub and every other badge for something
  // the user is only waiting on, so that stage gets a chip instead (see below).
  if (u.state === 'processing') return null
  const pct = Math.round(u.progress * 100)
  const failed = u.state === 'failed' || u.state === 'cancelled'
  const busy = u.state === 'queued' || u.state === 'uploading'
  const label =
    u.state === 'queued'
      ? 'Waiting to upload…'
      : u.state === 'uploading'
        ? `Uploading · ${progressText(u)}`
        : u.state === 'done'
          ? 'Uploaded'
          : u.state === 'failed'
            ? 'Upload failed'
            : 'Upload cancelled'
  return {
    icon: failed ? 'alert' : u.state === 'done' ? 'check' : 'cloud-upload',
    label,
    bar: u.state === 'uploading' ? pct : u.state === 'queued' ? null : undefined,
    failed,
    busy,
  }
})

/**
 * The YouTube chip in the corner, once the clip has a video. It carries what
 * YouTube last said, in the palette the card already uses: the reserved rose
 * for a video that is up and fine, amber for one it would not publish.
 */
const ytBadge = computed(() => {
  const clip = props.clip
  if (!clip.youtubeId || veil.value) return null
  switch (clip.youtubeStage) {
    case 'processing': {
      // Only spin while Sift is actually asking. Once it has stopped, a badge
      // that keeps spinning promises progress nothing is watching for.
      const watching = clip.youtubeWatchUntilMs > now.value
      return {
        label: 'Processing',
        icon: watching ? 'i-lucide-loader-circle' : 'i-lucide-clock',
        tone: 'busy',
        spin: watching,
        title: watching
          ? 'YouTube is processing this video'
          : 'YouTube was still processing this video when Sift last asked',
      }
    }
    case 'rejected':
      return {
        label: 'Rejected',
        icon: 'i-lucide-triangle-alert',
        tone: 'bad',
        spin: false,
        title: clip.youtubeReason || 'YouTube rejected this video',
      }
    case 'failed':
      return {
        label: 'Failed',
        icon: 'i-lucide-triangle-alert',
        tone: 'bad',
        spin: false,
        title: clip.youtubeReason || 'YouTube could not process this video',
      }
    default:
      return { label: 'YouTube', icon: 'i-lucide-youtube', tone: 'up', title: 'On YouTube' }
  }
})

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

/** Watched, and not while something is still happening to the card. */
const seen = computed(() => Boolean(props.clip.seenAtMs) && !veil.value)
</script>

<template>
  <article
    class="clip-card"
    :class="{ 'is-job': job, 'is-seen': seen }"
    :data-clip-id="clip.id"
    tabindex="0"
    :role="job ? 'group' : 'button'"
    :aria-label="job ? `${jobLabel} ${clip.title}` : `Play ${clip.title}`"
    :aria-busy="veil?.busy || undefined"
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
            <Icon
              :name="clip.probeState === 'failed' ? 'video-off' : 'film'"
              :size="26"
              :stroke="1.6"
            />
          </div>
        </Transition>

        <div v-if="hovering && canScrub" class="scrub" :class="{ 'is-loaded': spriteLoaded }">
          <img
            :src="sprite"
            alt=""
            decoding="async"
            :style="{
              width: `${frames * 100}%`,
              transform: `translate3d(${(-frame * 100) / frames}%, 0, 0)`,
            }"
            @load="spriteLoaded = true"
          />
          <div class="scrub-bar" :style="{ width: `${((frame + 0.5) / frames) * 100}%` }" />
        </div>

        <!-- Progress veil for an export in flight (the source poster sits behind
             it so the card already looks like the clip it will become) or for a
             YouTube upload of this clip. -->
        <div v-if="veil" class="job-veil" :class="{ 'is-failed': veil.failed, 'is-upload': !job }">
          <Icon
            :name="veil.icon"
            :size="22"
            :stroke="1.8"
            :class="{ spin: veil.icon === 'loader' }"
          />
          <span class="job-label">{{ veil.label }}</span>
          <UProgress
            v-if="veil.bar !== undefined"
            class="job-progress"
            :model-value="veil.bar"
            size="xs"
            color="primary"
            :aria-label="veil.label"
          />
          <UButton
            v-if="upload && !job && (upload.state === 'queued' || upload.state === 'uploading')"
            class="veil-cancel"
            icon="i-lucide-x"
            label="Cancel"
            color="neutral"
            variant="subtle"
            size="xs"
            @click.stop="emit('cancelUpload', upload.id)"
            @keydown.enter.stop
            @keydown.space.stop
          />
          <!-- A running export can be stopped from its own card, keyboard included;
               one that ended badly can be waved away. -->
          <UButton
            v-if="job && (job.state === 'queued' || job.state === 'running')"
            class="veil-cancel"
            icon="i-lucide-x"
            label="Cancel"
            color="neutral"
            variant="subtle"
            size="xs"
            @click.stop="emit('cancelJob', job.id)"
            @keydown.enter.stop
            @keydown.space.stop
          />
          <UButton
            v-else-if="job"
            class="veil-cancel"
            label="Dismiss"
            color="neutral"
            variant="subtle"
            size="xs"
            @click.stop="emit('dismissJob', job.id)"
            @keydown.enter.stop
            @keydown.space.stop
          />
        </div>

        <!-- Watched clips recede rather than disappear; hovering lifts the veil
             so pointing at a card always shows the real frame. -->
        <div v-if="seen" class="seen-scrim" aria-hidden="true" />

        <FavouriteButton v-if="!job" :clip="clip" variant="card" />

        <UBadge v-if="resolution && !job" class="badge res" size="sm" :label="resolution" />

        <!-- The right-hand corner carries what has happened to a clip; the left
             carries what it is. Grouped, so neither has to know the other is
             there and the pair stays inside the thumbnail on a compact card. -->
        <div v-if="seen || ytBadge" class="badges-tr">
          <UBadge v-if="seen" class="badge seen" size="sm" icon="i-lucide-check" label="Watched" />
          <UBadge
            v-if="ytBadge"
            class="badge yt"
            :class="`is-${ytBadge.tone}`"
            size="sm"
            :icon="ytBadge.icon"
            :label="ytBadge.label"
            :aria-label="ytBadge.title"
            :title="ytBadge.title"
            :ui="ytBadge.spin ? { leadingIcon: 'animate-spin' } : undefined"
          />
        </div>
        <UBadge
          v-if="clip.duration"
          class="badge duration mono"
          size="sm"
          :label="formatDuration(clip.duration)"
        />

        <!-- No play hint while a veil is up: it would sit on the veil's label. -->
        <span v-if="!veil" class="play-hint" aria-hidden="true">
          <Icon name="play" :size="20" />
        </span>
      </div>

      <div class="meta">
        <div class="text">
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

        <!-- The same list the right-click menu carries. Right-click is faster
             once you know it is there; this is how you find out, and it is the
             only way in on a card you reached with the keyboard. -->
        <UDropdownMenu
          v-if="menu.length"
          :items="menu"
          :content="{ align: 'end' }"
          :ui="{ content: 'min-w-52' }"
          @update:open="menuOpen = $event"
        >
          <UButton
            class="kebab"
            :class="{ 'is-open': menuOpen }"
            icon="i-lucide-ellipsis-vertical"
            color="neutral"
            variant="ghost"
            square
            size="sm"
            :aria-label="`More actions for ${clip.title}`"
            @click.stop
            @keydown.enter.stop
            @keydown.space.stop
          />
        </UDropdownMenu>
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
/* Reveals the favourite star, which lives in another component and so cannot be
   reached by a selector from here. FavouriteButton reads both. */
.clip-card:hover,
.clip-card:focus-visible,
.clip-card:focus-within {
  --fav-shown: 1;
  --fav-scale: 1;
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
  background: color-mix(in srgb, var(--scrim) 72%, transparent);
  backdrop-filter: blur(3px);
}
.job-veil.is-failed {
  color: var(--warning);
}
/* An upload or pending-action veil sits over a real clip: the card underneath keeps its click. */
.job-veil.is-upload {
  pointer-events: none;
}
/* The one thing on the veil you can press; it stops the click reaching the card. */
.veil-cancel {
  margin-top: var(--s-1);
  pointer-events: auto;
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
/* Sized here rather than left to `UBadge size="sm"`: its fixed 10px text in a
   py-1 box reads as a small label in a large chip. The app's smallest step in a
   tighter box is legible at a glance and keeps all four chips visually equal. */
.badge {
  position: absolute;
  bottom: 8px;
  right: 8px;
  padding: 2px 7px;
  gap: 4px;
  border-radius: var(--r-sm);
  background: var(--chip-bg);
  color: var(--fg-strong);
  font-family: var(--font-heading);
  font-size: var(--text-xs);
  line-height: 1.35;
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
/* History chips, right-aligned so YouTube keeps the corner it has always had and
   Watched grows leftward beside it instead of pushing it out. */
.badges-tr {
  position: absolute;
  top: 8px;
  right: 8px;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 6px;
  max-width: calc(100% - 16px);
}
.badges-tr .badge {
  position: static;
}
/* Watched is a state, not a spec, so it does not borrow the violet the quality
   chip uses — nor the rose reserved for YouTube, nor the filled primary the star
   owns. Plain white on the same dark chip is what is left, and it is also the
   most legible of the four. Never the off-palette green it used to be. */
.badge.seen {
  color: var(--fg-strong);
  box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.22);
}
/* Already on YouTube: the same chip as the others, told apart by the word and
   the rose glyph. The word itself stays as legible as every other label. */
.badge.yt {
  color: var(--fg-strong);
  box-shadow: 0 0 0 1px color-mix(in srgb, var(--accent) 40%, transparent);
}
.badge.yt :deep(svg) {
  color: var(--accent);
}
/* The rose says "this is on YouTube and it is fine". A video YouTube is still
   working on, or would not publish, borrows the amber every other unfinished
   or unhappy state in the app already uses rather than inventing a colour. */
.badge.yt.is-busy,
.badge.yt.is-bad,
.badge.yt.is-busy :deep(svg),
.badge.yt.is-bad :deep(svg) {
  color: var(--warning);
}
.badge.yt.is-busy,
.badge.yt.is-bad {
  box-shadow: 0 0 0 1px color-mix(in srgb, var(--warning) 40%, transparent);
}
/* A flat wash rather than `.poster { opacity }`: the poster already owns an
   opacity transition for its load-in and the two would fight. */
.seen-scrim {
  position: absolute;
  inset: 0;
  background: color-mix(in srgb, var(--scrim) 42%, transparent);
  pointer-events: none;
  transition: opacity var(--dur) var(--ease-out);
}
.clip-card:hover .seen-scrim,
.clip-card:focus-visible .seen-scrim {
  opacity: 0;
}
.clip-card.is-seen .title {
  color: var(--fg-muted);
}
.clip-card.is-seen:hover .title,
.clip-card.is-seen:focus-visible .title {
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
/* A fixed height, the same number as META_H in useVirtualGrid, so the font
   metrics can never move the strip and the composable apart. Inset on the sides
   because the hover ring sits on the card's edge. */
.meta {
  display: flex;
  align-items: center;
  gap: 4px;
  height: 68px;
  padding: 0 12px;
}
/* The two lines take whatever the menu button leaves; `min-width: 0` is what
   keeps their `truncate` honest inside a flex row. */
.text {
  flex: 1;
  min-width: 0;
}
/* Dim at rest so a wall of cards is not a wall of dots, but never hidden: an
   affordance you cannot see is one you cannot find. */
.kebab {
  flex: 0 0 auto;
  opacity: 0.7;
  transition: opacity var(--dur-fast) var(--ease-out);
}
.clip-card:hover .kebab,
.clip-card:focus-within .kebab,
.kebab.is-open,
.kebab:focus-visible {
  opacity: 1;
}
.title {
  font-size: var(--text-md);
  line-height: 1.25;
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
  line-height: 1.43;
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
