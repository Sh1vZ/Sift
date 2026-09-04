<script setup lang="ts">
import type { ChangelogBlock } from '@shared/changelog'
import ChangelogInline from './ChangelogInline.vue'
import ChangelogList from './ChangelogList.vue'

const ACCENTS: Record<string, string> = {
  added: 'var(--success)',
  changed: 'var(--secondary)',
  deprecated: 'var(--fg-dim)',
  removed: 'var(--destructive)',
  fixed: 'var(--warning)',
  security: 'var(--accent)'
}

defineProps<{ blocks: ChangelogBlock[] }>()

function accent(text: string): string {
  return ACCENTS[text.trim().toLowerCase()] ?? 'var(--fg-dim)'
}
</script>

<template>
  <div class="blocks">
    <template v-for="(block, i) in blocks" :key="i">
      <h3 v-if="block.kind === 'heading'" class="group" :style="{ '--group-accent': accent(block.text) }">
        <span class="dot" aria-hidden="true" />
        {{ block.text }}
      </h3>
      <p v-else-if="block.kind === 'paragraph'" class="para">
        <ChangelogInline :content="block.content" />
      </p>
      <ChangelogList v-else :items="block.items" />
    </template>
  </div>
</template>

<style scoped>
.blocks {
  display: flex;
  flex-direction: column;
  gap: var(--s-3);
  font-size: var(--text-sm);
  line-height: 1.6;
  color: var(--fg-muted);
  /* body sets user-select: none — release notes are worth copying out of. */
  user-select: text;
}

.group {
  display: flex;
  align-items: center;
  gap: var(--s-2);
  margin: var(--s-2) 0 0;
  font-family: var(--font-heading);
  font-size: var(--text-xs);
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--group-accent);
}

/* No leading gap above the first group in a section. */
.blocks > .group:first-child {
  margin-top: 0;
}

.dot {
  width: 6px;
  height: 6px;
  border-radius: var(--r-full);
  background: var(--group-accent);
  flex: none;
}

.para {
  margin: 0;
}
</style>
