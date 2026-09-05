import { computed, ref } from 'vue'
import {
  GOOGLE_CONSOLE_QUOTAS_URL,
  IDLE_YOUTUBE_STATE,
  formatUntil,
  isExhausted as exhaustedAt,
  type YouTubeAccount,
  type YouTubePlaylist,
  type YouTubePrivacy,
  type YouTubeState,
} from '@shared/youtube'
import { confirm, prompt } from './useDialogs'
import { now } from './useLibrary'
import { toast } from './useToasts'

/**
 * The connected Google projects, mirrored from main. Main owns the accounts
 * and their tokens; this is a read-through copy plus the actions the settings
 * pane and the upload dialog need. Secrets never reach this side: an account
 * carries `hasSecret`, not the secret.
 */
const api = window.api

export const youtube = ref<YouTubeState>({ ...IDLE_YOUTUBE_STATE })

export const accounts = computed(() => youtube.value.accounts)
export const connectedAccounts = computed(() =>
  accounts.value.filter((a) => a.connection === 'connected'),
)
export const anyConnected = computed(() => connectedAccounts.value.length > 0)
export const connectingAccount = computed(
  () => accounts.value.find((a) => a.connection === 'connecting') ?? null,
)

/** YouTube answered quotaExceeded for this project today; clears at midnight Pacific. */
export const isExhausted = (a: YouTubeAccount): boolean => exhaustedAt(a, now.value)

/** One wording for a parked project, wherever it shows: the row badge, the status line, the upload form. */
export const quotaResumesIn = (a: YouTubeAccount): string =>
  `Daily quota spent · resumes in ${formatUntil(a.quotaExhaustedUntilMs, now.value)}`

/** Connected projects that can still upload today. */
export const availableAccounts = computed(() =>
  connectedAccounts.value.filter((a) => !isExhausted(a)),
)

/** The same choice main makes under Auto: the first connected project not out of quota. */
export function autoPick(): YouTubeAccount | null {
  return availableAccounts.value[0] ?? null
}

export const accountById = (id: string): YouTubeAccount | undefined =>
  accounts.value.find((a) => a.id === id)

/** Projects with a disconnect or removal in flight (both talk to Google first). */
export const busyAccountIds = ref<string[]>([])
export const isBusy = (id: string): boolean => busyAccountIds.value.includes(id)

async function withBusy<T>(id: string, run: () => Promise<T>): Promise<T> {
  busyAccountIds.value = [...busyAccountIds.value, id]
  try {
    return await run()
  } finally {
    busyAccountIds.value = busyAccountIds.value.filter((x) => x !== id)
  }
}

export async function initYouTube(): Promise<void> {
  // Seed before subscribing, so a devtools reload restores the list at once.
  youtube.value = await api.youtube.state()
  api.on('youtube:changed', (next) => (youtube.value = next))
}

export async function addAccountJson(text: string): Promise<boolean> {
  const res = await api.youtube.addAccountJson(text)
  if (!res.ok) {
    toast('error', 'Could not add the project', res.error)
    return false
  }
  toast(
    'success',
    'Project added',
    `${res.account?.label ?? 'Project'} — press Connect to sign in.`,
  )
  return true
}

export async function addAccount(
  clientId: string,
  clientSecret: string,
  label: string,
): Promise<boolean> {
  const res = await api.youtube.addAccount(clientId, clientSecret, label)
  if (!res.ok) {
    toast('error', 'Could not add the project', res.error)
    return false
  }
  toast(
    'success',
    'Project added',
    `${res.account?.label ?? 'Project'} — press Connect to sign in.`,
  )
  return true
}

export async function importAccountFiles(): Promise<void> {
  const res = await api.youtube.importAccountFiles()
  if (res.cancelled) return
  if (res.added)
    toast(
      'success',
      res.added === 1 ? 'Project added' : `${res.added} projects added`,
      'Press Connect on each one to sign in.',
    )
  if (!res.ok) toast('error', 'Some files were not added', res.error)
}

export async function renameAccount(a: YouTubeAccount): Promise<void> {
  const label = await prompt({
    title: 'Rename project',
    label: 'Name',
    value: a.label,
    confirmLabel: 'Rename',
  })
  if (label === null || label.trim() === a.label) return
  const res = await api.youtube.renameAccount(a.id, label)
  if (!res.ok) toast('error', 'Could not rename the project', res.error)
}

export async function connectAccount(id: string): Promise<void> {
  const res = await api.youtube.connect(id)
  if (res.ok) {
    const a = accountById(id)
    toast('success', 'YouTube connected', a?.channel?.title ?? a?.label)
  } else if (res.error && !/cancelled/i.test(res.error)) {
    toast('error', 'Could not connect YouTube', res.error)
  }
}

export function cancelConnect(): void {
  void api.youtube.cancelConnect()
}

export async function disconnectAccount(a: YouTubeAccount): Promise<void> {
  const ok = await confirm({
    title: 'Disconnect this project?',
    message:
      'Sift forgets the sign-in and stops uploading through this project. The client stays, so reconnecting is one click.',
    detail: a.channel?.title ?? a.label,
    detailIcon: 'i-lucide-youtube',
    confirmLabel: 'Disconnect',
    danger: true,
  })
  if (!ok) return
  await withBusy(a.id, async () => {
    const res = await api.youtube.disconnect(a.id)
    if (!res.ok) toast('error', 'Could not disconnect', res.error)
  })
}

export async function removeAccount(a: YouTubeAccount): Promise<void> {
  const ok = await confirm({
    title: 'Remove this project?',
    message: 'The client and the sign-in are forgotten. Videos already on YouTube are not touched.',
    detail: a.label,
    detailIcon: 'i-lucide-youtube',
    confirmLabel: 'Remove',
    danger: true,
  })
  if (!ok) return
  await withBusy(a.id, async () => {
    const res = await api.youtube.removeAccount(a.id)
    if (!res.ok) toast('error', 'Could not remove the project', res.error)
  })
}

export async function loadPlaylists(
  accountId: string,
  refresh = false,
): Promise<YouTubePlaylist[] | null> {
  const res = await api.youtube.playlists(accountId, refresh)
  if (!res.ok || !res.playlists) {
    toast('error', 'Could not load playlists', res.error)
    return null
  }
  return res.playlists
}

export async function createPlaylist(
  accountId: string,
  title: string,
  privacy: YouTubePrivacy,
): Promise<YouTubePlaylist | null> {
  const res = await api.youtube.createPlaylist(accountId, title, privacy)
  if (!res.ok || !res.playlist) {
    toast('error', 'Could not create the playlist', res.error)
    return null
  }
  return res.playlist
}

/**
 * Documentation links open in the OS browser: `setWindowOpenHandler` in main
 * turns a `_blank` open into `shell.openExternal` after its scheme check.
 */
export function openExternalUrl(url: string): void {
  if (url.startsWith('https://')) window.open(url, '_blank', 'noreferrer')
}

/** The console's Quotas page for a project: the only place Google shows live usage without billing. */
export function openQuotaPage(a: YouTubeAccount): void {
  const q = a.projectId ? `?project=${encodeURIComponent(a.projectId)}` : ''
  openExternalUrl(`${GOOGLE_CONSOLE_QUOTAS_URL}${q}`)
}
