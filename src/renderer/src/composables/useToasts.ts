import { ref } from 'vue'

export type ToastKind = 'info' | 'success' | 'error'

export interface Toast {
  id: number
  kind: ToastKind
  title: string
  message?: string
}

/**
 * Composables outside component context can't call Nuxt UI's `useToast()`,
 * so they push here and <ToastBridge> (mounted inside <UApp>) forwards them.
 */
export const pending = ref<Toast[]>([])
let seq = 0

export function toast(kind: ToastKind, title: string, message?: string): void {
  pending.value = [...pending.value, { id: ++seq, kind, title, message }]
}

export function drain(): Toast[] {
  const out = pending.value
  pending.value = []
  return out
}
