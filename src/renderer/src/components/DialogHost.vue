<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { closeDialog, dialog, takeDialog, type ConfirmChoice } from '@/composables/useDialogs'

const value = ref('')
/** The prompt's UInput; its exposed `inputRef` is the native element. */
const input = ref<{ inputRef: HTMLInputElement | null } | null>(null)
const open = computed({
  get: () => dialog.value !== null,
  set: (v: boolean) => {
    if (!v) closeDialog()
  },
})

const isPrompt = computed(() => dialog.value?.kind === 'prompt')
const isAlert = computed(() => dialog.value?.kind === 'alert')
const danger = computed(() => dialog.value?.kind === 'confirm' && dialog.value.danger)
const alt = computed(() => (dialog.value?.kind === 'confirm' ? dialog.value.alt : undefined))
const alertAction = computed(() =>
  dialog.value?.kind === 'alert' ? dialog.value.action : undefined,
)
// An alert's detail is the raw failure, a confirm's is the file or folder it is about.
const detail = computed(() => (dialog.value?.kind === 'prompt' ? undefined : dialog.value?.detail))
const detailIcon = computed(() => {
  if (dialog.value?.kind === 'alert') return 'i-lucide-circle-alert'
  return dialog.value?.kind === 'confirm'
    ? (dialog.value.detailIcon ?? 'i-lucide-file')
    : 'i-lucide-file'
})
const description = computed(() =>
  dialog.value?.kind === 'prompt' ? undefined : dialog.value?.message,
)
const confirmLabel = computed(
  () => (dialog.value && dialog.value.kind !== 'alert' ? dialog.value.confirmLabel : '') || 'OK',
)
const canSubmit = computed(() => !isPrompt.value || value.value.trim().length > 0)

watch(dialog, (d) => {
  value.value = d?.kind === 'prompt' ? d.value : ''
  // A prompt opens with its text selected, so typing replaces the old name
  // outright. The modal mounts its body a frame after `dialog` is set, hence
  // the double wait.
  if (d?.kind === 'prompt')
    void nextTick(() => requestAnimationFrame(() => input.value?.inputRef?.select()))
})

function submit(choice: ConfirmChoice = 'confirm'): void {
  if (!dialog.value || !canSubmit.value) return
  const d = takeDialog()
  if (!d) return
  if (d.kind === 'confirm') d.resolve(choice)
  else if (d.kind === 'prompt') d.resolve(value.value)
  else d.resolve()
}

/** Closes the alert first, so the settings pane or folder it opens is not left under a modal. */
function runAlertAction(): void {
  const run = alertAction.value?.onClick
  submit()
  run?.()
}

// Enter confirms even when focus is on the dialog itself (confirm and alert dialogs have no input).
function onKey(e: KeyboardEvent): void {
  if (e.key === 'Enter' && dialog.value && dialog.value.kind !== 'prompt') {
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
    :description="description"
    :ui="{
      content: alt || isAlert ? 'max-w-lg' : 'max-w-md',
      header: 'pe-12 sm:pe-12',
      title: 'font-heading text-base',
      footer: 'flex-nowrap justify-end gap-3',
    }"
  >
    <template #title>
      <span class="title">
        <UIcon v-if="isAlert" name="i-lucide-octagon-alert" class="title-icon" />
        <span>{{ dialog?.title }}</span>
      </span>
    </template>
    <template v-if="isPrompt || detail" #body>
      <UFormField v-if="isPrompt" :label="dialog?.kind === 'prompt' ? dialog.label : ''">
        <UInput
          ref="input"
          v-model="value"
          class="w-full"
          autofocus
          spellcheck="false"
          @keydown.enter.prevent="submit()"
        />
      </UFormField>
      <p v-else class="detail" :class="{ 'detail-error': isAlert }">
        <UIcon :name="detailIcon" class="detail-icon" />
        <span class="detail-text">{{ detail }}</span>
      </p>
    </template>
    <template #footer>
      <template v-if="isAlert">
        <UButton
          v-if="alertAction"
          class="me-auto shrink-0"
          label="Close"
          color="neutral"
          variant="ghost"
          @click="submit()"
        />
        <UButton
          v-if="alertAction"
          class="shrink-0"
          :label="alertAction.label"
          :icon="alertAction.icon"
          color="primary"
          @click="runAlertAction"
        />
        <UButton v-else class="shrink-0" label="Close" color="primary" @click="submit()" />
      </template>
      <template v-else>
        <UButton
          label="Cancel"
          :class="alt ? 'me-auto shrink-0' : 'shrink-0'"
          color="neutral"
          variant="ghost"
          @click="closeDialog"
        />
        <UButton
          v-if="alt"
          class="me-2 shrink-0"
          :label="alt.label"
          :color="alt.danger ? 'error' : 'neutral'"
          variant="subtle"
          :icon="alt.icon"
          @click="submit('alt')"
        />
        <UButton
          class="shrink-0"
          :label="confirmLabel"
          :color="danger ? 'error' : 'primary'"
          :icon="danger ? 'i-lucide-trash-2' : undefined"
          :disabled="!canSubmit"
          @click="submit()"
        />
      </template>
    </template>
  </UModal>
</template>

<style scoped>
.title {
  display: flex;
  align-items: center;
  gap: var(--s-2);
}
.title-icon {
  flex: none;
  width: 18px;
  height: 18px;
  color: var(--destructive);
}
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
/* The raw failure from main: tinted so it reads as the reason, and scrollable
   because ffmpeg and the YouTube API both write long ones. */
.detail-error {
  align-items: flex-start;
  max-height: 30vh;
  overflow-y: auto;
  background: color-mix(in srgb, var(--destructive) 8%, var(--bg-2));
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--destructive) 28%, transparent);
}
.detail-icon {
  flex: none;
  width: 16px;
  height: 16px;
  color: var(--fg-muted);
}
.detail-error .detail-icon {
  margin-top: 2px;
  color: var(--destructive);
}
</style>
