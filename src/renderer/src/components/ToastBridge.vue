<script setup lang="ts">
import { watch } from 'vue'
import { useToast } from '@nuxt/ui/composables'
import { drain, pending, type ToastKind } from '@/composables/useToasts'

/** Forwards app-level toast() calls to Nuxt UI's toaster (rendered by <UApp>). */
const toaster = useToast()

const color: Record<ToastKind, 'primary' | 'success' | 'error'> = {
  info: 'primary',
  success: 'success',
  error: 'error'
}
const icon: Record<ToastKind, string> = {
  info: 'i-lucide-info',
  success: 'i-lucide-check',
  error: 'i-lucide-triangle-alert'
}

watch(pending, (list) => {
  if (!list.length) return
  for (const t of drain()) {
    toaster.add({
      title: t.title,
      description: t.message,
      color: color[t.kind],
      icon: icon[t.kind],
      actions: t.action
        ? [{ label: t.action.label, color: 'neutral', variant: 'outline', size: 'xs', onClick: t.action.onClick }]
        : undefined
    })
  }
})
</script>

<template>
  <span hidden />
</template>
