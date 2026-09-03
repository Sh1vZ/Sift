import { ref } from 'vue'

export type ToastKind = 'info' | 'success' | 'error'

export interface ToastAction {
  label: string
  onClick: () => void
}

export interface Toast {
  id: number
  kind: ToastKind
  title: string
  message?: string
  /** One optional follow-up, e.g. "View in Clips" after an export lands. */
  action?: ToastAction
}

/**
 * Composables outside component context can't call Nuxt UI's `useToast()`,
 * so they push here and <ToastBridge> (mounted inside <UApp>) forwards them.
 */
export const pending = ref<Toast[]>([])
let seq = 0

export function toast(kind: ToastKind, title: string, message?: string, action?: ToastAction): void {
  pending.value = [...pending.value, { id: ++seq, kind, title, message, action }]
}

export function drain(): Toast[] {
  const out = pending.value
  pending.value = []
  return out
}
