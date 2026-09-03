<script setup lang="ts">
import { computed } from 'vue'
import { dismissWhatsNew, whatsNew } from '@/composables/useUpdates'

/**
 * Shown once, the first time a build runs after Sift has updated itself. The
 * notes come from the CHANGELOG.md bundled with the app rather than the update
 * feed — by the time a version is running there is nothing left to fetch — and
 * are plain text, so nothing here renders markup.
 *
 * Dismissing is what records the version as seen, so notes the user never got to
 * are offered again next launch instead of being silently consumed.
 */
const open = computed({
  get: () => whatsNew.value !== null,
  set: (v: boolean) => {
    if (!v) dismissWhatsNew()
  }
})
</script>

<template>
  <UModal
    v-model:open="open"
    :title="`What's new in Sift ${whatsNew?.version ?? ''}`"
    description="Sift updated itself since you last used it."
    :ui="{ content: 'max-w-lg', header: 'pe-12 sm:pe-12', title: 'font-heading text-base' }"
  >
    <template #body>
      <pre class="notes">{{ whatsNew?.notes }}</pre>
    </template>
    <template #footer>
      <UButton class="ms-auto shrink-0" label="Got it" color="primary" @click="dismissWhatsNew()" />
    </template>
  </UModal>
</template>

<style scoped>
.notes {
  margin: 0;
  max-height: 50vh;
  overflow-y: auto;
  font-family: inherit;
  font-size: var(--text-sm);
  line-height: 1.55;
  color: var(--fg);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  user-select: text;
}
</style>
