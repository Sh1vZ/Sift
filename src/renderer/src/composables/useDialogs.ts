import { ref } from 'vue'

interface ConfirmOptions {
  title: string
  message: string
  /** The subject of the action (file name, folder path) — shown on its own line so a long name never crowds the copy. */
  detail?: string
  detailIcon?: string
  confirmLabel?: string
  danger?: boolean
}

interface PromptOptions {
  title: string
  label: string
  value: string
  confirmLabel?: string
}

interface ConfirmState extends ConfirmOptions {
  kind: 'confirm'
  resolve: (ok: boolean) => void
}
interface PromptState extends PromptOptions {
  kind: 'prompt'
  resolve: (value: string | null) => void
}

export const dialog = ref<ConfirmState | PromptState | null>(null)

export function confirm(opts: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    dialog.value = { kind: 'confirm', ...opts, resolve }
  })
}

export function prompt(opts: PromptOptions): Promise<string | null> {
  return new Promise((resolve) => {
    dialog.value = { kind: 'prompt', ...opts, resolve }
  })
}

export function closeDialog(): void {
  const d = dialog.value
  dialog.value = null
  if (!d) return
  if (d.kind === 'confirm') d.resolve(false)
  else d.resolve(null)
}
