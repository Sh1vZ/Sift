<script setup lang="ts">
import type { ChangelogInline } from '@shared/changelog'

defineProps<{ content: ChangelogInline[] }>()
</script>

<template>
  <template v-for="(run, i) in content" :key="i">
    <strong v-if="run.kind === 'strong'">{{ run.text }}</strong>
    <em v-else-if="run.kind === 'em'">{{ run.text }}</em>
    <code v-else-if="run.kind === 'code'" class="code">{{ run.text }}</code>
    <a
      v-else-if="run.kind === 'link'"
      class="link"
      :href="run.href"
      target="_blank"
      rel="noreferrer"
      >{{ run.text }}</a
    >
    <template v-else>{{ run.text }}</template>
  </template>
</template>

<style scoped>
strong {
  font-weight: 600;
  color: var(--fg);
}

em {
  font-style: italic;
}

.code {
  padding: 1px 5px;
  border: 1px solid var(--border);
  border-radius: var(--r-sm);
  background: var(--bg-1);
  font-family: var(--font-mono);
  font-size: 0.92em;
  color: var(--secondary);
}

.link {
  color: var(--secondary);
  text-decoration: underline;
  text-underline-offset: 2px;
  text-decoration-color: color-mix(in srgb, var(--secondary) 45%, transparent);
  cursor: pointer;
  transition: color var(--dur-fast) var(--ease-out);
}

.link:hover {
  color: var(--primary-hover);
  text-decoration-color: currentcolor;
}
</style>
