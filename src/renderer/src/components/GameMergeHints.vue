<script setup lang="ts">
import { computed } from 'vue'
import { dismissMergeSuggestion, mergeSuggestions, setGameAlias } from '@/composables/useLibrary'

/**
 * One look-alike pair at a time — `apex_legends` beside `Apex Legends`. Only the
 * first is shown so the strip can never grow into a wall; merging or dismissing
 * it reveals the next. Nothing is ever merged on Sift's own initiative: two
 * folders that look alike are not always the same game.
 */
const hint = computed(() => mergeSuggestions.value[0] ?? null)

const names = computed(() => hint.value?.games.map((g) => g.name) ?? [])
const rest = computed(() => Math.max(0, mergeSuggestions.value.length - 1))

/** No confirm dialog: clicking Merge on the hint that names both games *is* the answer. */
async function merge(): Promise<void> {
  const h = hint.value
  if (!h) return
  // Everything folds into the busiest name, which `mergeSuggestions` puts first.
  await setGameAlias(
    h.games.flatMap((g) => g.sources),
    h.games[0].name,
  )
}
</script>

<template>
  <div v-if="hint" class="hints">
    <UAlert
      icon="i-lucide-merge"
      color="neutral"
      variant="subtle"
      :title="`“${names[0]}” and “${names[1]}” look like the same game`"
      :description="
        rest
          ? `Merging shows them as one card. Nothing on disk is renamed or moved. ${rest} more pair${rest === 1 ? '' : 's'} look alike too.`
          : 'Merging shows them as one card. Nothing on disk is renamed or moved.'
      "
      :actions="[
        { label: 'Merge', color: 'primary', variant: 'subtle', onClick: () => void merge() },
        {
          label: 'Keep them separate',
          color: 'neutral',
          variant: 'ghost',
          onClick: () => void dismissMergeSuggestion(hint!.key),
        },
      ]"
    />
  </div>
</template>

<style scoped>
.hints {
  padding: 0 28px 14px;
}
</style>
