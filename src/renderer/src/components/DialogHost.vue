<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { closeDialog, dialog } from '@/composables/useDialogs'

const value = ref('')
const open = computed({
  get: () => dialog.value !== null,
  set: (v: boolean) => {
    if (!v) closeDialog()
  }
})

const isPrompt = computed(() => dialog.value?.kind === 'prompt')
const danger = computed(() => dialog.value?.kind === 'confirm' && dialog.value.danger)
const detail = computed(() => (dialog.value?.kind === 'confirm' ? dialog.value.detail : undefined))
const detailIcon = computed(() =>
  dialog.value?.kind === 'confirm' ? (dialog.value.detailIcon ?? 'i-lucide-file') : 'i-lucide-file'
)
const canSubmit = computed(() => !isPrompt.value || value.value.trim().length > 0)

watch(dialog, (d) => {
  value.value = d?.kind === 'prompt' ? d.value : ''
})

function submit(): void {
  const d = dialog.value
  if (!d || !canSubmit.value) return
  dialog.value = null
  if (d.kind === 'confirm') d.resolve(true)
  else d.resolve(value.value)
}

// Enter confirms even when focus is on the dialog itself (confirm dialogs have no input).
function onKey(e: KeyboardEvent): void {
  if (e.key === 'Enter' && dialog.value?.kind === 'confirm') {
    e.preventDefault()
    submit()
  }
}
watch(open, (v) => {
  if (v) window.addEventListener('keydown', onKey)
  else window.removeEventListener('keydown', onKey)
})
</script>

<template>
  <!-- `header: pe-12` keeps the title/description clear of the close button, which Nuxt UI
       positions absolutely at the top-right of the panel. -->
  <UModal
    v-model:open="open"
    :title="dialog?.title"
    :description="dialog?.kind === 'confirm' ? dialog.message : undefined"
    :ui="{
      content: 'max-w-md',
      header: 'pe-12 sm:pe-12',
      title: 'font-heading text-base',
      footer: 'justify-end'
    }"
  >
    <template v-if="isPrompt || detail" #body>
      <UFormField v-if="isPrompt" :label="dialog?.kind === 'prompt' ? dialog.label : ''">
        <UInput v-model="value" class="w-full" size="lg" autofocus spellcheck="false" @keydown.enter.prevent="submit" />
      </UFormField>
      <p v-else class="detail">
        <UIcon :name="detailIcon" class="detail-icon" />
        <span class="detail-text">{{ detail }}</span>
      </p>
    </template>
    <template #footer>
      <UButton label="Cancel" color="neutral" variant="ghost" @click="closeDialog" />
      <UButton
        :label="dialog?.confirmLabel ?? 'OK'"
        :color="danger ? 'error' : 'primary'"
        :icon="danger ? 'i-lucide-trash-2' : undefined"
        :disabled="!canSubmit"
        @click="submit"
      />
    </template>
  </UModal>
</template>

<style scoped>
.detail {
  display: flex;
  align-items: center;
  gap: var(--s-2);
  margin: 0;
  padding: var(--s-2) var(--s-3);
  border-radius: var(--r-md);
  background: var(--bg-2);
  box-shadow: inset 0 0 0 1px var(--border);
  font-size: var(--text-sm);
  color: var(--fg);
  overflow-wrap: anywhere;
  user-select: text;
}
.detail-icon {
  flex: none;
  width: 16px;
  height: 16px;
  color: var(--fg-muted);
}
</style>
