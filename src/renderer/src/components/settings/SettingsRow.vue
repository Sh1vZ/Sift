<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import Icon from '../Icon.vue'
import { motionEnabled } from '@/composables/useMotion'
import { highlightRow } from '@/composables/useSettings'

/**
 * A settings row: icon tile, text block that takes the slack, then the value
 * and control hard right. The hairline between rows lives here, so rows must
 * be direct siblings inside a flush panel body. A row with an `id` from
 * SETTINGS_ROWS is what the rail search lands on: it scrolls into view and
 * flashes its ring.
 */
const props = withDefaults(
  defineProps<{
    icon: string
    title: string
    description?: string
    /** Mono figure shown before the trailing control. */
    value?: string
    /** A selectable path or file name under the description. */
    path?: string
    tone?: 'default' | 'warning'
    /** `li` when the rows are a real list, e.g. the folder list. */
    tag?: string
    /** Matches an entry in SETTINGS_ROWS, so the rail search can land here. */
    id?: string
  }>(),
  { description: '', value: '', path: '', tone: 'default', tag: 'div', id: '' },
)

const root = ref<HTMLElement | null>(null)
const lit = computed(() => Boolean(props.id) && highlightRow.value === props.id)

watch(lit, (on) => {
  if (on)
    root.value?.scrollIntoView({
      block: 'center',
      behavior: motionEnabled.value ? 'smooth' : 'auto',
    })
})
</script>

<template>
  <component
    :is="tag"
    ref="root"
    class="row"
    :class="{ 'is-lit': lit }"
    :data-row="id || undefined"
  >
    <span class="row-icon" :class="{ 'is-warning': tone === 'warning' }">
      <Icon :name="icon" :size="18" />
    </span>
    <div class="row-text">
      <span class="row-title-line">
        <slot name="title">
          <span class="row-title">{{ title }}</span>
        </slot>
        <slot name="badges" />
      </span>
      <p v-if="description" class="row-desc">{{ description }}</p>
      <p v-if="path" class="row-path truncate" :title="path">{{ path }}</p>
      <slot />
    </div>
    <span v-if="value" class="row-value mono">{{ value }}</span>
    <div v-if="$slots.trailing" class="row-trailing"><slot name="trailing" /></div>
  </component>
</template>

<style scoped>
.row {
  display: flex;
  align-items: center;
  gap: var(--s-3);
  /* Horizontal padding matches the card header so labels line up down the panel. */
  padding: var(--s-4) var(--s-6);
  transition: box-shadow var(--dur) var(--ease-out);
}
.row + .row {
  border-top: 1px solid var(--border);
}
/* The search landed here. */
.row.is-lit {
  box-shadow: inset 0 0 0 2px var(--ring);
}
.row-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  flex: 0 0 auto;
  border-radius: var(--r-md);
  background: var(--bg-3);
  color: var(--secondary);
}
.row-icon.is-warning {
  background: color-mix(in srgb, var(--warning) 14%, transparent);
  color: var(--warning);
}
.row-text {
  flex: 1;
  min-width: 0;
  margin-right: var(--s-2);
}
.row-title-line {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--s-2);
}
.row-title {
  font-weight: 600;
  font-size: var(--text-md);
}
.row-desc {
  margin-top: 2px;
  font-size: var(--text-sm);
  color: var(--fg-muted);
  line-height: 1.45;
}
.row-path {
  margin-top: 2px;
  font-size: var(--text-sm);
  color: var(--fg-muted);
  user-select: text;
}
.row-value {
  flex: 0 0 auto;
  font-size: var(--text-md);
  font-weight: 600;
  color: var(--fg);
}
.row-trailing {
  display: flex;
  align-items: center;
  gap: var(--s-2);
  flex: 0 0 auto;
}
</style>
