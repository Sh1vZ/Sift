<script setup lang="ts">
import { computed } from 'vue'
import {
  closeGifPreview,
  gifPreview,
  gifPreviewSrc,
  retryGifPreview,
  saveGifPreview,
} from '@/composables/useGifPreview'
import { formatBytes, formatTimecode } from '@/utils/format'

/**
 * The GIF as the export would write it, looked at before it is saved. Main
 * renders it into the cache; Save opens the save dialog and the export that
 * follows copies the file, so the wait is here, once, rather than after the
 * dialog. Closing mid-render stops the render.
 */
const open = computed({
  get: () => gifPreview.value !== null,
  set: (v: boolean) => {
    if (!v) closeGifPreview()
  },
})
const p = computed(() => gifPreview.value)
const percent = computed(() => Math.round((p.value?.progress ?? 0) * 100))
const settingsLine = computed(() => {
  const v = p.value
  if (!v) return ''
  return `${v.width} × ${v.height} · ${v.fps} fps · ${formatTimecode(v.end - v.start)}`
})
const summary = computed(() => {
  const v = p.value
  if (!v) return ''
  if (v.state === 'ready')
    return `${formatBytes(v.preview?.bytes ?? 0)}. Saving copies this file; nothing is rendered again.`
  if (v.state === 'rendering')
    return 'Every frame is decoded twice: once to choose the colours, once to paint them.'
  return ''
})
</script>

<template>
  <UModal
    v-model:open="open"
    title="GIF preview"
    :description="settingsLine"
    :ui="{
      content: 'max-w-4xl',
      header: 'pe-12 sm:pe-12',
      title: 'font-heading text-lg',
      description: 'text-sm',
      body: 'p-0 sm:p-0',
      footer: 'justify-between gap-4',
    }"
  >
    <template #body>
      <div v-if="p" class="body">
        <!-- Sized to the GIF from the start, so the picture landing moves nothing. -->
        <div
          class="stage"
          :style="{ width: `${p.width}px`, aspectRatio: `${p.width} / ${p.height}` }"
        >
          <img
            v-if="p.state === 'ready'"
            :src="gifPreviewSrc"
            :width="p.width"
            :height="p.height"
            alt=""
            class="gif"
          />
          <div
            v-else-if="p.state === 'rendering'"
            class="rendering"
            role="status"
            aria-live="polite"
          >
            <UProgress
              class="bar"
              :model-value="percent"
              :max="100"
              color="primary"
              aria-label="Rendering"
            />
            <p class="mono">Rendering… {{ percent }}%</p>
          </div>
          <UAlert
            v-else
            class="failed"
            color="error"
            variant="subtle"
            icon="i-lucide-triangle-alert"
            title="The preview could not be rendered"
            :description="p.error || 'ffmpeg reported an error but gave no message.'"
          />
        </div>
      </div>
    </template>
    <template #footer>
      <p class="summary">{{ summary }}</p>
      <div class="actions">
        <UButton label="Close" color="neutral" variant="ghost" @click="open = false" />
        <UButton
          v-if="p?.state === 'failed'"
          icon="i-lucide-rotate-ccw"
          label="Try again"
          color="neutral"
          variant="subtle"
          @click="retryGifPreview"
        />
        <UButton
          v-else
          icon="i-lucide-download"
          label="Save GIF"
          color="primary"
          variant="soft"
          :disabled="p?.state !== 'ready'"
          @click="saveGifPreview"
        />
      </div>
    </template>
  </UModal>
</template>

<style scoped>
.body {
  display: flex;
  justify-content: center;
  padding: var(--s-6);
}
.stage {
  display: grid;
  place-items: center;
  max-width: 100%;
  overflow: hidden;
  border-radius: var(--r-md);
  background: var(--bg-0);
}
.gif {
  display: block;
  width: 100%;
  height: auto;
}
.rendering {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--s-3);
  width: min(100%, 320px);
  padding: var(--s-4);
  text-align: center;
  font-size: var(--text-sm);
  color: var(--fg-muted);
}
.rendering p {
  margin: 0;
}
.bar {
  width: 100%;
}
.failed {
  max-width: 100%;
  margin: var(--s-4);
}
.summary {
  flex: 1;
  min-width: 0;
  margin: 0;
  font-size: var(--text-sm);
  color: var(--fg-muted);
}
.actions {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  gap: var(--s-2);
}
</style>
