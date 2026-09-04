<script setup lang="ts">
import { SHORTCUT_GROUPS, shortcutsOpen } from '@/composables/useShortcuts'

/**
 * The keyboard reference, opened with `?` anywhere or from Settings → Playback.
 * Always mounted like the other dialogs so the key works before any screen has
 * rendered it.
 */
</script>

<template>
  <UModal
    v-model:open="shortcutsOpen"
    title="Keyboard shortcuts"
    description="They work anywhere in Sift, unless a text field has focus."
    :ui="{
      content: 'max-w-3xl',
      header: 'pe-12 sm:pe-12',
      title: 'font-heading text-lg',
      description: 'text-sm',
      body: 'p-0 sm:p-0',
    }"
  >
    <template #body>
      <div class="groups">
        <section v-for="g in SHORTCUT_GROUPS" :key="g.title" class="group">
          <h4>{{ g.title }}</h4>
          <dl>
            <div v-for="row in g.rows" :key="row.label" class="row">
              <dt>
                <template v-for="(chord, i) in row.chords" :key="i">
                  <span v-if="i" class="or">or</span>
                  <span class="chord">
                    <UKbd v-for="k in chord" :key="k" :value="k" size="md" />
                  </span>
                </template>
              </dt>
              <dd>{{ row.label }}</dd>
            </div>
          </dl>
        </section>
      </div>
    </template>
    <template #footer>
      <UButton
        class="ms-auto shrink-0"
        label="Got it"
        color="primary"
        @click="shortcutsOpen = false"
      />
    </template>
  </UModal>
</template>

<style scoped>
.groups {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: var(--s-6);
  max-height: min(64vh, 620px);
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: var(--s-5) var(--s-6) var(--s-6);
}
.group {
  min-width: 0;
}
h4 {
  margin-bottom: var(--s-2);
  padding-bottom: var(--s-2);
  border-bottom: 1px solid var(--border);
  font-size: var(--text-sm);
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--fg-muted);
}
dl {
  margin: 0;
}
.row {
  display: flex;
  flex-direction: column;
  gap: var(--s-1);
  padding: var(--s-2) 0;
}
.row + .row {
  border-top: 1px solid var(--border);
}
dt {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--s-1);
}
.chord {
  display: inline-flex;
  align-items: center;
  gap: 3px;
}
.or {
  margin: 0 var(--s-1);
  font-size: var(--text-xs);
  color: var(--fg-dim);
}
dd {
  margin: 0;
  font-size: var(--text-base);
  color: var(--fg);
}
</style>
