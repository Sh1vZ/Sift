<script setup lang="ts">
import Icon from '../Icon.vue'

/**
 * A settings row: icon tile, text block that takes the slack, then the value
 * and control hard right. The hairline between rows lives here, so rows must
 * be direct siblings inside a flush panel body.
 */
withDefaults(
  defineProps<{
    icon: string
    title: string
    description?: string
    /** Mono figure shown before the trailing control. */
    value?: string
    tone?: 'default' | 'warning'
    /** `li` when the rows are a real list, e.g. the folder list. */
    tag?: string
  }>(),
  { description: '', value: '', tone: 'default', tag: 'div' },
)
</script>

<template>
  <component :is="tag" class="row">
    <span class="row-icon" :class="{ 'is-warning': tone === 'warning' }">
      <Icon :name="icon" :size="18" />
    </span>
    <div class="row-text">
      <slot name="title">
        <span class="row-title">{{ title }}</span>
      </slot>
      <p v-if="description" class="row-desc">{{ description }}</p>
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
}
.row + .row {
  border-top: 1px solid var(--border);
}
.row-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  flex: 0 0 auto;
  border-radius: var(--r-md);
  background: var(--bg-3);
  color: var(--secondary);
}
.row-icon.is-warning {
  background: rgba(251, 191, 36, 0.14);
  color: var(--warning);
}
.row-text {
  flex: 1;
  min-width: 0;
  margin-right: var(--s-2);
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
.row-value {
  flex: 0 0 auto;
  font-size: var(--text-md);
  font-weight: 600;
  color: var(--fg);
}
.row-trailing {
  display: flex;
  align-items: center;
  gap: var(--s-1);
  flex: 0 0 auto;
}
</style>
