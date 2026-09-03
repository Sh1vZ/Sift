import { app } from 'electron'
import electronUpdater, { type ProgressInfo, type UpdateInfo } from 'electron-updater'
import { IDLE_UPDATE_STATE, type UpdateState } from '@shared/types'
import { updaterDev } from './env'
import type { Emit } from './library'

// electron-updater is CommonJS and this bundle is ESM, so the named export cannot
// be resolved statically — `import { autoUpdater }` throws at runtime.
const { autoUpdater } = electronUpdater

/** Long enough for the launch scan to settle before competing for the network. */
const FIRST_CHECK_MS = 15_000
/** Sift lives in the tray for days at a time, so the interval does real work. */
const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000
/** Notes are a teaser in the settings pane, not the whole document. */
const NOTES_MAX = 4000

export interface Updater {
  /** Current state; safe to call before any check has run. */
  state(): UpdateState
  /** Runs a check now. A manual check reports failures; a background one stays quiet. */
  check(manual?: boolean): Promise<UpdateState>
  /** Starts or stops the periodic check. Manual checks work either way. */
  setAutoCheck(enabled: boolean): void
  /** True once the user has asked to install and the app is quitting to do it. */
  wantsInstall(): boolean
  /** Records the intent and starts a normal quit. No-op unless an update is downloaded. */
  install(): void
  /** Spawns the installer. Must run *after* the library has flushed — see main/index.ts. */
  runInstaller(): void
  dispose(): void
}

/**
 * Whether this build follows prereleases. The GitHub provider does not use named
 * channels the way the generic one does — electron-builder always writes
 * `latest.yml` for it (`computeChannelNames` short-circuits on provider ===
 * 'github') and marks the release itself as a prerelease instead. So the only
 * knob that matters is `allowPrerelease`, and it should mirror the running build:
 * a `-beta.N` build takes betas, a stable build takes only stable releases.
 *
 * Deliberately no `autoUpdater.channel`: setting it would send the provider
 * looking for a `beta.yml` that is never published, and it would only work at all
 * because of an internal fallback to `latest.yml`.
 */
function isPrerelease(version: string): boolean {
  return version.includes('-')
}

function decodeEntities(s: string): string {
  return (
    s
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#0*39;/g, "'")
      .replace(/&nbsp;/g, ' ')
      // Last, so an escaped entity like &amp;lt; does not decode twice.
      .replace(/&amp;/g, '&')
  )
}

/**
 * GitHub serves release bodies through its atom feed as *rendered HTML*, and with
 * `fullChangelog` they arrive as one entry per intervening release. Both shapes
 * are flattened to plain text here, in main, so the renderer is never handed
 * markup it would have to decide whether to trust.
 */
function plainNotes(notes: UpdateInfo['releaseNotes']): string {
  if (!notes) return ''
  const raw =
    typeof notes === 'string'
      ? notes
      : notes.map((n) => `${n.version}\n${n.note ?? ''}`).join('\n\n')

  const text = decodeEntities(
    raw
      .replace(/<\s*(br|\/p|\/li|\/h[1-6]|\/div|\/tr)\s*\/?>/gi, '\n')
      .replace(/<\s*li[^>]*>/gi, '• ')
      .replace(/<[^>]+>/g, '')
  )
    .split(/\r?\n/)
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()

  return text.length > NOTES_MAX ? `${text.slice(0, NOTES_MAX).trimEnd()}…` : text
}

function friendlyError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err)
  if (/ERR_UPDATER_CHANNEL_FILE_NOT_FOUND|404/i.test(message)) return 'No update feed for this build yet.'
  if (/ENOTFOUND|EAI_AGAIN|ETIMEDOUT|ECONNRESET|ENETUNREACH|net::/i.test(message)) return 'Could not reach GitHub.'
  return message.split('\n')[0]?.trim() || 'The update check failed.'
}

/**
 * Wraps electron-updater in a small state machine and pushes every transition to
 * the renderer as `update:changed`.
 *
 * Downloads happen on their own (`autoDownload`); the user is only asked to
 * restart. Installing is deliberately split in two — see `install` / `runInstaller`
 * and the `before-quit` handler in main/index.ts — because `quitAndInstall` spawns
 * the NSIS installer *before* quitting, which would race the library's flush.
 */
export function createUpdater(opts: { emit: Emit; quit: () => void }): Updater {
  const currentVersion = app.getVersion()

  // A dev build has no app-update.yml, so touching autoUpdater at all just
  // produces noise. The UI reads `unsupported` and shows why instead of offering
  // a button that cannot work.
  if (!app.isPackaged && !updaterDev) {
    const inert: UpdateState = { ...IDLE_UPDATE_STATE, status: 'unsupported', currentVersion }
    return {
      state: () => ({ ...inert }),
      check: async () => ({ ...inert }),
      setAutoCheck: () => {},
      wantsInstall: () => false,
      install: () => {},
      runInstaller: () => {},
      dispose: () => {}
    }
  }

  const state: UpdateState = { ...IDLE_UPDATE_STATE, currentVersion }
  let installRequested = false
  let manualCheck = false
  let first: NodeJS.Timeout | null = null
  let repeat: NodeJS.Timeout | null = null

  const snapshot = (): UpdateState => ({ ...state })

  const push = (patch: Partial<UpdateState>): void => {
    Object.assign(state, patch)
    opts.emit('update:changed', snapshot())
  }

  // A beta build is offered the newest non-alpha release, stable ones included,
  // so promoting the beta line to stable does not strand anyone.
  autoUpdater.allowPrerelease = isPrerelease(currentVersion)
  autoUpdater.allowDowngrade = false
  autoUpdater.autoDownload = true
  // A plain quit (the tray's Quit item) finishes an already-downloaded update.
  autoUpdater.autoInstallOnAppQuit = true
  // Someone three betas behind should see all three sets of notes.
  autoUpdater.fullChangelog = true
  autoUpdater.forceDevUpdateConfig = updaterDev
  autoUpdater.logger = {
    info: (m) => console.log('[updater]', m),
    warn: (m) => console.warn('[updater]', m),
    error: (m) => console.error('[updater]', m),
    debug: () => {}
  }

  autoUpdater.on('checking-for-update', () => push({ status: 'checking', error: '' }))

  autoUpdater.on('update-available', (info: UpdateInfo) => {
    // autoDownload means this is immediately followed by download-progress; the
    // 'available' state is only ever seen in the gap.
    push({ status: 'available', version: info.version, notes: plainNotes(info.releaseNotes), progress: 0, error: '' })
  })

  autoUpdater.on('update-not-available', () => {
    push({ status: 'up-to-date', version: '', notes: '', progress: 0, error: '', checkedAtMs: Date.now() })
  })

  autoUpdater.on('download-progress', (p: ProgressInfo) => {
    push({ status: 'downloading', progress: p.percent / 100, bytesPerSecond: p.bytesPerSecond })
  })

  autoUpdater.on('update-downloaded', (info: UpdateInfo) => {
    push({
      status: 'downloaded',
      version: info.version,
      notes: plainNotes(info.releaseNotes) || state.notes,
      progress: 1,
      bytesPerSecond: 0,
      error: '',
      checkedAtMs: Date.now()
    })
  })

  autoUpdater.on('error', (err: Error) => {
    const message = friendlyError(err)
    // Only a check the user asked for gets an error state. A background check that
    // could not reach GitHub is not worth interrupting anyone over, so it lands
    // back on `idle` with the reason kept for the settings pane.
    if (manualCheck) push({ status: 'error', error: message, version: '', progress: 0, bytesPerSecond: 0 })
    else push({ status: 'idle', error: message, progress: 0, bytesPerSecond: 0 })
  })

  const check = async (manual = false): Promise<UpdateState> => {
    if (state.status === 'checking' || state.status === 'downloading') return snapshot()
    manualCheck = manual
    try {
      await autoUpdater.checkForUpdates()
    } catch (err) {
      // checkForUpdates rejects *and* emits 'error'; the handler already pushed
      // the state, so there is nothing to do but keep the rejection from escaping.
      console.error('[updater] check failed', err)
    }
    return snapshot()
  }

  const clearTimers = (): void => {
    if (first) clearTimeout(first)
    if (repeat) clearInterval(repeat)
    first = null
    repeat = null
  }

  return {
    state: snapshot,
    check,
    setAutoCheck(enabled) {
      clearTimers()
      if (!enabled) return
      first = setTimeout(() => void check(), FIRST_CHECK_MS)
      repeat = setInterval(() => void check(), CHECK_INTERVAL_MS)
    },
    wantsInstall: () => installRequested,
    install() {
      if (state.status !== 'downloaded') return
      installRequested = true
      opts.quit()
    },
    runInstaller() {
      if (!installRequested) return
      // isSilent: perMachine is false, so the installer writes into a folder the
      // user owns and needs no UI and no UAC prompt. isForceRunAfter: come back up.
      autoUpdater.quitAndInstall(true, true)
    },
    dispose: clearTimers
  }
}
