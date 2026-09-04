<script setup lang="ts">
import type { ChangelogItem } from '@shared/changelog'
import ChangelogInline from './ChangelogInline.vue'

defineProps<{ items: ChangelogItem[]; nested?: boolean }>()
</script>

<template>
  <ul class="list" :class="{ nested }">
    <li v-for="(item, i) in items" :key="i" class="item">
      <ChangelogInline :content="item.content" />
      <ChangelogList v-if="item.children.length" :items="item.children" nested />
    </li>
  </ul>
</template>

<style scoped>
.list {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: var(--s-2);
}

.list.nested {
  margin-top: var(--s-2);
  gap: var(--s-1);
}

.item {
  position: relative;
  padding-left: var(--s-4);
  color: var(--fg-muted);
}

.item::before {
  content: "";
  position: absolute;
  left: 3px;
  top: 0.62em;
  width: 4px;
  height: 4px;
  border-radius: var(--r-full);
  background: color-mix(in srgb, var(--secondary) 70%, transparent);
}

.list.nested .item::before {
  background: var(--fg-dim);
}
</style>
