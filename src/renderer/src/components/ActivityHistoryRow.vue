<script setup lang="ts">
import { computed } from 'vue'
import type { ActivityRecord } from '@shared/types'
import { activityOpen } from '@/composables/useActivity'
import {
  historyActions,
  historyClickable,
  historyGone,
  historyIcon,
  historyLine,
  openHistoryRecord,
  removeActivity,
  type HistoryAction,
} from '@/composables/useActivityHistory'
import { allClips, now } from '@/composables/useLibrary'
import { formatFull, formatRelative } from '@/utils/format'

/**
 * One finished piece of work. The row itself goes to what it is about (the
 * clip, the game, the folder list); the buttons act on it in place. Once the
 * clip has left the library the row says so and its clip-bound buttons stay,
 * disabled, so the layout does not jump.
 */
const props = defineProps<{ record: ActivityRecord }>()

// `getClip` reads a Map outside Vue's reactivity; `allClips` rebuilds on every
// index change, so depending on it makes "gone" and the buttons follow a
// delete or a rename the moment it lands.
const gone = computed(() => {
  void allClips.value
  return historyGone(props.record)
})
const clickable = computed(() => {
  void allClips.value
  return historyClickable(props.record)
})
const actions = computed<HistoryAction[]>(() => {
  void allClips.value
  return historyActions(props.record)
})
const line = computed(() => (gone.value ? 'Clip no longer exists' : historyLine(props.record)))
const when = computed(() => formatRelative(props.record.finishedAtMs, now.value))

function open(): void {
  if (openHistoryRecord(props.record)) activityOpen.value = false
}

function run(action: HistoryAction): void {
  action.onSelect()
  if (action.navigates) activityOpen.value = false
}
</script>

<template>
  <li
    class="item"
    :class="{ 'is-clickable': clickable }"
    :role="clickable ? 'button' : undefined"
    :tabindex="clickable ? 0 : undefined"
    @click="clickable && open()"
    @keydown.enter.prevent="clickable && open()"
  >
    <UIcon
      :name="historyIcon(record)"
      class="item-icon"
      :class="{ 'is-failed': record.status === 'failed', 'is-gone': gone }"
    />
    <div class="text">
      <p class="title truncate" :title="record.title">{{ record.title }}</p>
      <p class="line truncate" :class="{ 'is-gone': gone }">{{ line }}</p>
    </div>
    <UTooltip :text="formatFull(record.finishedAtMs)">
      <span class="when">{{ when }}</span>
    </UTooltip>
    <div class="actions" @click.stop @keydown.enter.stop>
      <UTooltip v-for="a in actions" :key="a.label" :text="a.label">
        <UButton
          :icon="a.icon"
          color="neutral"
          variant="ghost"
          size="sm"
          square
          :disabled="a.disabled"
          :aria-label="a.label"
          @click="run(a)"
        />
      </UTooltip>
      <UTooltip text="Remove from history">
        <UButton
          icon="i-lucide-x"
          color="neutral"
          variant="ghost"
          size="sm"
          square
          aria-label="Remove from history"
          @click="removeActivity(record.id)"
        />
      </UTooltip>
    </div>
  </li>
</template>

<style scoped>
.item {
  display: flex;
  align-items: center;
  gap: var(--s-3);
  padding: var(--s-3) var(--s-4);
  outline: none;
}
.item + .item {
  border-top: 1px solid var(--border);
}
.item.is-clickable {
  cursor: pointer;
}
.item.is-clickable:hover,
.item.is-clickable:focus-visible {
  background: color-mix(in srgb, var(--fg) 5%, transparent);
}
.item.is-clickable:focus-visible {
  box-shadow: inset 0 0 0 1px var(--border-active);
}
.item-icon {
  flex: none;
  width: 20px;
  height: 20px;
  color: var(--secondary);
}
.item-icon.is-failed {
  color: var(--warning);
}
.item-icon.is-gone {
  color: var(--fg-dim);
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
.line.is-gone {
  color: var(--fg-dim);
}
.when {
  flex: none;
  font-size: var(--text-xs);
  color: var(--fg-dim);
  white-space: nowrap;
}
.actions {
  display: flex;
  align-items: center;
  flex: none;
}
</style>
