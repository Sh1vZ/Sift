<script setup lang="ts">
/**
 * Per-track volume, mute and solo for a clip with more than one audio stream.
 *
 * Lives in its own component because the player shows it in two places: beside
 * the speed control while you are watching, and in the trim row while you are
 * editing, where the tracks you leave audible are the tracks the export keeps.
 *
 * State belongs to `useAudioMixer`; `change` is emitted after every mutation so
 * the player can push the new gains onto the media elements, which only it
 * holds. `toggle` keeps the auto-hide timer from pulling the controls out from
 * under an open panel.
 */
import {
  audibleTracks,
  gains,
  isDefaultMix,
  mixSummary,
  mutes,
  setGain,
  setMute,
  setTrackName,
  showAll,
  solo,
  tracks,
} from '@/composables/useAudioMixer'

const emit = defineEmits<{ change: []; toggle: [] }>()

function isSolo(index: number): boolean {
  const audible = audibleTracks.value
  return audible.length === 1 && audible[0] === index
}

function soloTrack(index: number): void {
  // Clicking "Only" on the track already soloed is how you get back to all of
  // them; a button that does nothing on the second press is a dead end.
  if (isSolo(index)) showAll()
  else solo(index)
  emit('change')
}

function resetMix(): void {
  showAll()
  emit('change')
}

/** Whole percent, and 0 while muted so the slider agrees with what you hear. */
function trackPercent(index: number): number {
  if (mutes.value[index]) return 0
  return Math.round((gains.value[index] ?? 1) * 100)
}

function onSlide(index: number, e: Event): void {
  const value = Number((e.target as HTMLInputElement).value) / 100
  // Dragging a muted track back up is the obvious way to unmute it.
  if (value > 0 && mutes.value[index]) setMute(index, false)
  setGain(index, value)
  emit('change')
}

function onMute(index: number, value: boolean): void {
  setMute(index, value)
  emit('change')
}

function onRename(index: number, e: Event): void {
  setTrackName(index, (e.target as HTMLInputElement).value)
}
</script>

<template>
  <!-- The button reads out which track you are hearing: a plain icon leaves the
       whole feature invisible, and "which audio am I getting" is the question
       it exists to answer. -->
  <UPopover
    :content="{ side: 'top', align: 'end', sideOffset: 10 }"
    :ui="{ content: 'p-0' }"
    @update:open="emit('toggle')"
  >
    <UTooltip text="Audio tracks" :kbds="['A']">
      <UButton
        class="mix"
        icon="i-lucide-audio-lines"
        :label="mixSummary"
        :color="isDefaultMix ? 'neutral' : 'primary'"
        :variant="isDefaultMix ? 'ghost' : 'soft'"
        :aria-label="`Audio tracks: ${mixSummary}`"
      />
    </UTooltip>

    <template #content>
      <div class="mixer">
        <header class="mixer-head">
          <h2 class="mixer-title">Audio tracks</h2>
          <UButton
            label="Reset"
            color="neutral"
            variant="ghost"
            size="xs"
            :disabled="isDefaultMix"
            @click="resetMix"
          />
        </header>

        <div
          v-for="track in tracks"
          :key="track.index"
          class="mixer-row"
          :class="{ 'is-off': mutes[track.index] }"
        >
          <div class="mixer-top">
            <!-- Editable in place: the recorder names none of these, so the
                 only way a track becomes "Mic" is if you say so. -->
            <input
              class="mixer-name"
              :value="track.name"
              :aria-label="`Name of track ${track.index + 1}`"
              maxlength="40"
              spellcheck="false"
              @change="onRename(track.index, $event)"
              @keydown.enter.prevent="(e: KeyboardEvent) => (e.target as HTMLInputElement).blur()"
              @keydown.stop
            />
            <span v-if="track.hint" class="mixer-hint">{{ track.hint }}</span>
            <UButton
              class="mixer-solo"
              label="Only"
              :color="isSolo(track.index) ? 'primary' : 'neutral'"
              :variant="isSolo(track.index) ? 'soft' : 'ghost'"
              size="xs"
              :aria-pressed="isSolo(track.index)"
              :aria-label="`Play only ${track.label}`"
              @click="soloTrack(track.index)"
            />
          </div>

          <div class="mixer-bottom">
            <UButton
              :icon="mutes[track.index] ? 'i-lucide-volume-x' : 'i-lucide-volume-2'"
              color="neutral"
              variant="ghost"
              square
              size="xs"
              :aria-label="`${mutes[track.index] ? 'Unmute' : 'Mute'} ${track.label}`"
              :aria-pressed="mutes[track.index]"
              @click="onMute(track.index, !mutes[track.index])"
            />
            <input
              class="mixer-range"
              type="range"
              min="0"
              max="100"
              step="1"
              :value="trackPercent(track.index)"
              :style="{ '--fill': `${trackPercent(track.index)}%` }"
              :aria-label="`${track.label} volume`"
              @input="onSlide(track.index, $event)"
              @keydown.stop
            />
            <span class="mixer-pct mono">{{ trackPercent(track.index) }}%</span>
          </div>
        </div>

        <p class="mixer-foot">
          Names are kept for every clip. Press <UKbd value="A" size="sm" /> to step through tracks.
        </p>
      </div>
    </template>
  </UPopover>
</template>

<style scoped>
.mix {
  /* Fixed width so "All" → "Mic" does not shuffle the controls beside it. */
  min-width: 96px;
  text-transform: none;
}
.mixer {
  display: flex;
  flex-direction: column;
  width: 288px;
  padding: var(--s-3);
  gap: var(--s-1);
}
.mixer-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--s-2);
  margin-bottom: var(--s-1);
}
.mixer-title {
  font-size: var(--text-xs);
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--fg-dim);
}
.mixer-row {
  display: flex;
  flex-direction: column;
  gap: var(--s-1);
  padding: var(--s-2);
  border-radius: var(--r-md);
  transition: opacity var(--dur-fast) var(--ease-out);
}
.mixer-row:hover {
  background: rgba(255, 255, 255, 0.04);
}
/* A muted track stays legible — you still have to find it to turn it back on. */
.mixer-row.is-off {
  opacity: 0.55;
}
.mixer-top,
.mixer-bottom {
  display: flex;
  align-items: center;
  gap: var(--s-2);
}
.mixer-name {
  flex: 1;
  min-width: 0;
  padding: 2px var(--s-1);
  margin-left: calc(var(--s-1) * -1);
  font-size: var(--text-sm);
  color: var(--fg);
  background: transparent;
  border: 1px solid transparent;
  border-radius: var(--r-md);
  transition:
    border-color var(--dur-fast) var(--ease-out),
    background var(--dur-fast) var(--ease-out);
}
.mixer-name:hover {
  border-color: var(--border);
}
.mixer-name:focus {
  outline: none;
  background: rgba(255, 255, 255, 0.06);
  border-color: var(--primary);
}
.mixer-hint {
  flex: none;
  font-size: var(--text-xs);
  color: var(--fg-dim);
}
.mixer-solo {
  flex: none;
  text-transform: none;
}
.mixer-range {
  flex: 1;
  min-width: 0;
  height: 6px;
  appearance: none;
  border-radius: var(--r-full);
  cursor: pointer;
  /* Fill is painted into the track, so there is no second element to keep in
     step with the thumb. */
  background: linear-gradient(
    to right,
    var(--secondary) 0 var(--fill),
    rgba(255, 255, 255, 0.22) var(--fill) 100%
  );
}
.mixer-range::-webkit-slider-thumb {
  appearance: none;
  width: 12px;
  height: 12px;
  border-radius: var(--r-full);
  background: var(--fg);
  border: none;
  transition: transform var(--dur-fast) var(--ease-out);
}
.mixer-range:hover::-webkit-slider-thumb,
.mixer-range:focus-visible::-webkit-slider-thumb {
  transform: scale(1.25);
}
.mixer-range:focus-visible {
  outline: 2px solid var(--primary);
  outline-offset: 3px;
}
.mixer-pct {
  flex: none;
  /* Room for "100%" so the slider does not resize as the number does. */
  width: 38px;
  text-align: right;
  font-size: var(--text-xs);
  color: var(--fg-muted);
}
.mixer-foot {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  margin-top: var(--s-2);
  padding-top: var(--s-2);
  border-top: 1px solid var(--border);
  font-size: var(--text-xs);
  color: var(--fg-dim);
}
</style>
