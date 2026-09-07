import { nextTick, ref } from 'vue'

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

/** The one follow-up an error dialog offers, e.g. "Open YouTube settings". */
interface AlertAction {
  label: string
  icon?: string
  onClick: () => void
}

interface AlertOptions {
  title: string
  /** What the failure means for the user and what to do about it — not the raw error. */
  message: string
  /** The failure exactly as main reported it, shown verbatim and selectable. */
  detail?: string
  action?: AlertAction
}

interface ConfirmState extends ConfirmOptions {
  kind: 'confirm'
  resolve: (choice: ConfirmChoice) => void
}
interface PromptState extends PromptOptions {
  kind: 'prompt'
  resolve: (value: string | null) => void
}
interface AlertState extends AlertOptions {
  kind: 'alert'
  resolve: () => void
}

export type DialogState = ConfirmState | PromptState | AlertState

export const dialog = ref<DialogState | null>(null)

/**
 * One modal is on screen at a time; anything raised while it is up waits here
 * rather than replacing it. An export that fails while a delete confirm is open
 * must not swallow the answer the user was about to give.
 */
const waiting: DialogState[] = []

function present(state: DialogState): void {
  if (dialog.value) waiting.push(state)
  else dialog.value = state
}

/** Latched: closing a modal can reach `takeDialog` twice (the host, then the
 * `update:open` that follows), and two flushes would shift one dialog in and
 * the next callback would clear it again without ever resolving it. */
let flushing = false

function flush(): void {
  if (flushing || !waiting.length) return
  flushing = true
  void nextTick(() => {
    flushing = false
    dialog.value ??= waiting.shift() ?? null
  })
}

/**
 * Clears the open dialog and lets the next one through a tick later, so the
 * modal animates out before the next animates in. The caller resolves what it
 * takes — that is the only way a dialog's promise ever settles.
 */
export function takeDialog(): DialogState | null {
  const d = dialog.value
  dialog.value = null
  flush()
  return d
}

function openConfirm(opts: ConfirmOptions): Promise<ConfirmChoice> {
  return new Promise((resolve) => {
    present({ kind: 'confirm', ...opts, resolve })
  })
}

export function confirm(opts: ConfirmOptions): Promise<boolean> {
  return openConfirm(opts).then((choice) => choice === 'confirm')
}

/** Three-way confirm: the primary action, the `alt` action, or cancel. */
export function confirmWithAlt(
  opts: ConfirmOptions & { alt: ConfirmAction },
): Promise<ConfirmChoice> {
  return openConfirm(opts)
}

export function prompt(opts: PromptOptions): Promise<string | null> {
  return new Promise((resolve) => {
    present({ kind: 'prompt', ...opts, resolve })
  })
}

const alertKey = (o: AlertOptions): string => o.title + ' :: ' + (o.detail ?? '')

/**
 * A failure the user has to read: work that was lost, a file left as it was, a
 * sign-in that did not happen. Everything smaller stays a toast — see
 * `useToasts`. Callers do not await this; the dialog is the notice, not a gate.
 */
export function alertError(opts: AlertOptions): Promise<void> {
  // A burst of the same failure (a batch of exports, a render error that
  // repeats every frame) is one problem, so it gets one dialog.
  const key = alertKey(opts)
  const showing = dialog.value?.kind === 'alert' && alertKey(dialog.value) === key
  if (showing || waiting.some((d) => d.kind === 'alert' && alertKey(d) === key))
    return Promise.resolve()
  return new Promise((resolve) => {
    present({ kind: 'alert', ...opts, resolve })
  })
}

export function closeDialog(): void {
  const d = takeDialog()
  if (!d) return
  if (d.kind === 'confirm') d.resolve('cancel')
  else if (d.kind === 'prompt') d.resolve(null)
  else d.resolve()
}
