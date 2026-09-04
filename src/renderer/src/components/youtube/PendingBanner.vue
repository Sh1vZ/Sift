<script setup lang="ts">
import Icon from '../Icon.vue'

/**
 * A slow action on the open clip (deleting, renaming, removing from YouTube),
 * shown over the top edge of the player until it settles. Same footprint as
 * the upload banner so the two never fight for the spot.
 */
defineProps<{ label: string }>()
</script>

<template>
  <div class="banner" role="status" aria-live="polite" @click.stop @dblclick.stop>
    <Icon name="loader" :size="18" :stroke="1.9" class="banner-icon spin" />
    <p class="title">{{ label }}</p>
    <UProgress class="bar" :model-value="null" size="xs" color="primary" :aria-label="label" />
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
  background: linear-gradient(180deg, rgba(7, 7, 18, 0.94), rgba(7, 7, 18, 0.78));
  backdrop-filter: blur(6px);
  border-bottom: 1px solid var(--border);
  cursor: default;
}
.banner-icon {
  color: var(--secondary);
}
.title {
  flex: 1;
  min-width: 0;
  font-family: var(--font-heading);
  font-size: var(--text-sm);
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}
.bar {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
}
</style>
