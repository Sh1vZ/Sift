<script setup lang="ts">
import { computed, ref } from 'vue'
import type { Clip } from '@shared/types'
import ClickSpark from './bits/ClickSpark.vue'
import Icon from './Icon.vue'
import { toggleFavourite } from '@/composables/useLibrary'
import { motionEnabled } from '@/composables/useMotion'
import { activeTheme } from '@/composables/useTheme'

/**
 * The star, everywhere it appears: on a card, in the player's control bar and
 * in the details pane. One component so the three surfaces agree on the label,
 * the pressed state and the burst — the card needs its own circular treatment
 * because it sits on a thumbnail, the other two are ordinary control-bar buttons.
 */
const props = withDefaults(
  defineProps<{
    clip: Clip
    /** `card` is the hover-revealed disc over a thumbnail; `chrome` matches the buttons beside it. */
    variant?: 'card' | 'chrome'
  }>(),
  { variant: 'chrome' },
)

// Structural rather than `InstanceType<typeof ClickSpark>`: .vue modules carry
// no types for eslint, and this is the whole of the surface we call.
const spark = ref<{ spark: (e?: MouseEvent) => void } | null>(null)

const label = computed(() =>
  props.clip.favourite ? 'Remove from favourites' : 'Add to favourites',
)

/**
 * Which way the star just moved, so each direction gets its own answer. Keyed off
 * the click rather than off `favourite`, or every already-starred card would
 * animate as it mounts while you scroll the grid.
 */
const pulse = ref<'on' | 'off' | null>(null)

function onClick(e: MouseEvent): void {
  const adding = !props.clip.favourite
  // Sparks celebrate adding only. Removing gets an inward pulse instead — it
  // still needs an answer, just not a congratulatory one.
  if (adding) spark.value?.spark(e)
  pulse.value = adding ? 'on' : 'off'
  void toggleFavourite(props.clip)
}
</script>

<template>
  <span class="fav" :class="`is-${variant}`">
    <!-- An overlay beside the button, never wrapping it. The tooltip trigger has
         to be the button itself, and a spark canvas sitting between the pointer
         and the button is exactly the sort of thing that swallows a click. -->
    <ClickSpark
      ref="spark"
      class="burst"
      :disabled="!motionEnabled"
      :spark-color="activeTheme.colors.primary"
      :spark-count="12"
      :spark-radius="20"
      :spark-size="14"
      :line-width="2.5"
      :duration="520"
    />
    <UTooltip :text="label" :kbds="variant === 'chrome' ? ['S'] : undefined">
      <UButton
        v-if="variant === 'chrome'"
        class="chrome-btn"
        :class="{
          'is-on': clip.favourite,
          'pulse-on': pulse === 'on',
          'pulse-off': pulse === 'off',
        }"
        icon="i-lucide-star"
        :color="clip.favourite ? 'primary' : 'neutral'"
        :variant="clip.favourite ? 'soft' : 'ghost'"
        square
        size="lg"
        :aria-label="label"
        :aria-pressed="clip.favourite"
        @click="onClick"
        @animationend="pulse = null"
      />
      <button
        v-else
        type="button"
        class="card-btn"
        :class="{
          'is-on': clip.favourite,
          'pulse-on': pulse === 'on',
          'pulse-off': pulse === 'off',
        }"
        :aria-label="label"
        :aria-pressed="clip.favourite"
        @click.stop="onClick"
        @animationend="pulse = null"
        @keydown.enter.stop
        @keydown.space.stop
      >
        <Icon name="star" :size="16" :stroke="1.9" />
      </button>
    </UTooltip>
  </span>
</template>

<style scoped>
/* A positioning frame only — it never sits between the pointer and the button. */
.fav.is-card {
  position: absolute;
  left: 0;
  bottom: 0;
  width: 68px;
  height: 68px;
  /* Bottom-left is the one free corner of a thumbnail: resolution is top-left,
     YouTube top-right, duration bottom-right. The frame runs up and to the right
     of the disc, which is where there is room for the burst to travel. */
  pointer-events: none;
}
.fav.is-chrome {
  position: relative;
  display: inline-flex;
}
/* ClickSpark's root carries `relative w-full h-full` from upstream; it has to be
   sized and taken out of the flow here, or it claims the whole row. */
.burst {
  position: absolute;
  inset: 0;
  pointer-events: none;
}
/* Reaching past the button gives the sparks somewhere to go without changing the
   button's own box, so the spacing to its neighbours is untouched. */
.fav.is-chrome .burst {
  inset: -14px;
}
.card-btn {
  position: absolute;
  left: 8px;
  bottom: 8px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  border-radius: 50%;
  color: #f1f5f9;
  background: rgba(10, 10, 24, 0.82);
  backdrop-filter: blur(4px);
  cursor: pointer;
  pointer-events: auto;
  /* The card owns the reveal, and it is in another component's style scope — a
     selector cannot reach across that, but an inherited custom property can.
     ClipCard sets `--fav-shown` on hover and focus; see its `.clip-card` rules. */
  opacity: var(--fav-shown, 0);
  transform: scale(var(--fav-scale, 0.8));
  transition:
    opacity var(--dur) var(--ease-out),
    transform var(--dur) var(--ease-spring),
    color var(--dur-fast) var(--ease-out),
    background-color var(--dur-fast) var(--ease-out);
}
/* Starred reads at rest — that is the whole point of starring. */
.card-btn:focus-visible,
.card-btn.is-on {
  --fav-shown: 1;
  --fav-scale: 1;
}
/* Hover must NOT borrow the favourited colour. When both looked the same, turning
   a favourite off while the pointer was still on the star looked like nothing had
   happened at all. Hover only lifts the disc; the theme colour means "starred". */
.card-btn:hover {
  color: #ffffff;
  background: rgba(10, 10, 24, 0.95);
}
/* Favourited is a filled disc in the theme's own colour — a different kind of
   thing from "the pointer is here", not a brighter shade of it. */
.card-btn.is-on {
  color: var(--on-primary);
  background: var(--primary);
}
/* Press answers immediately, whether or not the pulse is allowed to run. */
.card-btn:active {
  transform: scale(0.86);
  transition-duration: var(--dur-fast);
}
/* Each direction gets its own answer: out for starring, in for unstarring.
   `html.no-motion` collapses both. */
.card-btn.pulse-on :deep(.icon),
.chrome-btn.pulse-on :deep(span[class*='i-lucide-star']) {
  animation: fav-on var(--dur) var(--ease-spring);
}
.card-btn.pulse-off :deep(.icon),
.chrome-btn.pulse-off :deep(span[class*='i-lucide-star']) {
  animation: fav-off var(--dur) var(--ease-out);
}
@keyframes fav-on {
  0% {
    transform: scale(1);
  }
  45% {
    transform: scale(1.35);
  }
  100% {
    transform: scale(1);
  }
}
@keyframes fav-off {
  0% {
    transform: scale(1);
  }
  45% {
    transform: scale(0.7);
  }
  100% {
    transform: scale(1);
  }
}
</style>
