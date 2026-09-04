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
  /** Optional follow-ups, e.g. "View in Clips" after an export lands; usually one, at most two. */
  actions: ToastAction[]
}

/**
 * Composables outside component context can't call Nuxt UI's `useToast()`,
 * so they push here and <ToastBridge> (mounted inside <UApp>) forwards them.
 */
export const pending = ref<Toast[]>([])
let seq = 0

export function toast(
  kind: ToastKind,
  title: string,
  message?: string,
  action?: ToastAction | ToastAction[],
): void {
  const actions = action ? (Array.isArray(action) ? action : [action]) : []
  pending.value = [...pending.value, { id: ++seq, kind, title, message, actions }]
}

export function drain(): Toast[] {
  const out = pending.value
  pending.value = []
  return out
}
