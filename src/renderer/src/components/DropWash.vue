<script setup lang="ts">
/**
 * The wash a drop zone paints while a folder is being dragged over it. Sits
 * absolutely inside a `position: relative` zone and takes no pointer events,
 * so the drag keeps hitting the zone underneath.
 */
withDefaults(defineProps<{ label?: string }>(), { label: 'Drop to add the folder' })
</script>

<template>
  <div class="wash" aria-hidden="true">
    <UIcon name="i-lucide-folder-input" class="wash-icon" />
    <span class="wash-label">{{ label }}</span>
  </div>
</template>

<style scoped>
.wash {
  position: absolute;
  inset: var(--s-3);
  z-index: 3;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--s-2);
  border: 2px dashed var(--border-active);
  border-radius: var(--r-lg);
  background: var(--primary-soft);
  color: var(--secondary);
  pointer-events: none;
}
.wash-icon {
  width: 36px;
  height: 36px;
}
.wash-label {
  font-family: var(--font-heading);
  font-size: var(--text-md);
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}
</style>
