import { ref } from 'vue'

/** A third footer button beside Cancel and the confirm button. */
interface ConfirmAction {
  label: string
  icon?: string
  danger?: boolean
}

/** What the confirm dialog was closed with. */
export type ConfirmChoice = 'confirm' | 'alt' | 'cancel'

interface ConfirmOptions {
  title: string
  message: string
  /** The subject of the action (file name, folder path) — shown on its own line so a long name never crowds the copy. */
  detail?: string
  detailIcon?: string
  confirmLabel?: string
  danger?: boolean
  alt?: ConfirmAction
}

interface PromptOptions {
  title: string
  label: string
  value: string
  confirmLabel?: string
}

interface ConfirmState extends ConfirmOptions {
  kind: 'confirm'
  resolve: (choice: ConfirmChoice) => void
}
interface PromptState extends PromptOptions {
  kind: 'prompt'
  resolve: (value: string | null) => void
}

export const dialog = ref<ConfirmState | PromptState | null>(null)

function openConfirm(opts: ConfirmOptions): Promise<ConfirmChoice> {
  return new Promise((resolve) => {
    dialog.value = { kind: 'confirm', ...opts, resolve }
  })
}

export function confirm(opts: ConfirmOptions): Promise<boolean> {
  return openConfirm(opts).then((choice) => choice === 'confirm')
}

/** Three-way confirm: the primary action, the `alt` action, or cancel. */
export function confirmWithAlt(opts: ConfirmOptions & { alt: ConfirmAction }): Promise<ConfirmChoice> {
  return openConfirm(opts)
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
  if (d.kind === 'confirm') d.resolve('cancel')
  else d.resolve(null)
}
