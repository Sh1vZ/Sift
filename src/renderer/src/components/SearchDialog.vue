<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import type { Clip } from '@shared/types'
import Icon from './Icon.vue'
import { now } from '@/composables/useLibrary'
import { closeSearch, openResult, results, searchOpen, searchQuery } from '@/composables/useSearch'
import { formatDuration, formatRelative } from '@/utils/format'

/**
 * Global clip search. Hand-rolled rather than UCommandPalette: the ranking and
 * the punctuation-insensitive matching live in `useSearch`, and a component
 * with its own fuzzy filter on top would fight both.
 */
const api = window.api
const input = ref<{ inputRef?: HTMLInputElement } | null>(null)
const listEl = ref<HTMLElement | null>(null)
const active = ref(0)

const open = computed({
  get: () => searchOpen.value,
  set: (v: boolean) => {
    if (!v) closeSearch()
  },
})

// A new set of results always starts from the top, or the highlight would point
// at whatever happened to sit at that index for the previous query.
watch(results, () => (active.value = 0))

watch(searchOpen, (v) => {
  if (!v) return
  active.value = 0
  void nextTick(() => input.value?.inputRef?.focus())
})

function move(delta: number): void {
  const n = results.value.length
  if (!n) return
  active.value = (active.value + delta + n) % n
  void nextTick(() => {
    listEl.value?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' })
  })
}

function choose(clip?: Clip): void {
  const target = clip ?? results.value[active.value]
  if (target) void openResult(target)
}

function onKey(e: KeyboardEvent): void {
  switch (e.key) {
    case 'ArrowDown':
      move(1)
      break
    case 'ArrowUp':
      move(-1)
      break
    case 'Enter':
      choose()
      break
    default:
      return
  }
  e.preventDefault()
}

const poster = (c: Clip): string => (c.thumb ? api.thumbUrl(c.thumb) : '')
</script>

<template>
  <UModal
    v-model:open="open"
    title="Search clips"
    description="Find any clip in your library by name or game."
    :ui="{ content: 'max-w-2xl', header: 'sr-only', body: 'p-0 sm:p-0' }"
  >
    <template #body>
      <div class="palette">
        <UInput
          ref="input"
          v-model="searchQuery"
          class="query"
          size="xl"
          variant="none"
          icon="i-lucide-search"
          placeholder="Search every clip…"
          autocomplete="off"
          :ui="{ base: 'text-base' }"
          @keydown="onKey"
        >
          <template v-if="searchQuery" #trailing>
            <UButton
              icon="i-lucide-x"
              color="neutral"
              variant="ghost"
              size="xs"
              aria-label="Clear search"
              @click="searchQuery = ''"
            />
          </template>
        </UInput>

        <div v-if="results.length" ref="listEl" class="results" role="listbox">
          <button
            v-for="(c, i) in results"
            :key="c.id"
            type="button"
            class="row"
            role="option"
            :data-active="i === active"
            :aria-selected="i === active"
            @click="choose(c)"
            @mousemove="active = i"
          >
            <span class="thumb">
              <img v-if="poster(c)" :src="poster(c)" alt="" loading="lazy" decoding="async" />
              <Icon v-else name="film" :size="16" :stroke="1.6" />
              <span v-if="c.duration" class="len mono">{{ formatDuration(c.duration) }}</span>
            </span>
            <span class="text">
              <span class="title truncate">{{ c.title }}</span>
              <span class="sub truncate">
                <span class="game">{{ c.game }}</span>
                <span class="dot">·</span>
                <span>{{ formatRelative(c.recordedAtMs, now) }}</span>
              </span>
            </span>
            <Icon v-if="c.favourite" class="star" name="star" :size="15" :stroke="1.8" />
            <UIcon v-if="c.youtubeId" class="yt" name="i-lucide-youtube" />
          </button>
        </div>

        <div v-else class="state">
          <Icon :name="searchQuery ? 'search-x' : 'search'" :size="22" :stroke="1.5" />
          <p>
            {{ searchQuery ? `No clips match “${searchQuery}”` : 'Start typing to find a clip.' }}
          </p>
        </div>

        <div class="foot">
          <span><UKbd value="up" /><UKbd value="down" /> to move</span>
          <span><UKbd value="enter" /> to open</span>
          <span><UKbd value="esc" /> to close</span>
        </div>
      </div>
    </template>
  </UModal>
</template>

<style scoped>
.palette {
  display: flex;
  flex-direction: column;
  min-height: 0;
}
.query {
  width: 100%;
  border-bottom: 1px solid var(--border);
}
.results {
  max-height: 52vh;
  overflow-y: auto;
  padding: var(--s-2);
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.row {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  padding: 8px;
  border-radius: var(--r-md);
  text-align: left;
  cursor: pointer;
  transition: background var(--dur-fast) var(--ease-out);
}
.row[data-active='true'] {
  background: var(--bg-3);
}
.thumb {
  position: relative;
  flex: 0 0 auto;
  width: 84px;
  aspect-ratio: 16 / 9;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--r-sm);
  overflow: hidden;
  background: var(--bg-3);
  box-shadow: inset 0 0 0 1px var(--border);
  color: var(--fg-dim);
}
.thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.len {
  position: absolute;
  right: 3px;
  bottom: 3px;
  padding: 0 3px;
  border-radius: 3px;
  font-size: 10px;
  color: #f1f5f9;
  background: rgba(10, 10, 24, 0.82);
}
.text {
  display: flex;
  flex-direction: column;
  min-width: 0;
  flex: 1;
}
.title {
  font-size: var(--text-md);
  font-weight: 600;
  color: var(--fg);
}
.row[data-active='true'] .title {
  color: var(--secondary);
}
.sub {
  display: flex;
  gap: 5px;
  margin-top: 2px;
  font-size: var(--text-sm);
  color: var(--fg-muted);
}
.game {
  color: var(--secondary);
}
.dot {
  color: var(--fg-dim);
}
.star {
  flex: 0 0 auto;
  color: var(--warning);
}
.yt {
  flex: 0 0 auto;
  color: var(--accent);
}
.state {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--s-2);
  padding: var(--s-8) var(--s-4);
  color: var(--fg-muted);
  font-size: var(--text-sm);
}
.foot {
  display: flex;
  gap: 14px;
  padding: 8px 12px;
  border-top: 1px solid var(--border);
  font-size: var(--text-sm);
  color: var(--fg-dim);
}
.foot span {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
</style>
