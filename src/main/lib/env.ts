import { app } from 'electron'

/**
 * Environment knobs. Two sources, deliberately different in scope:
 *
 * - `SIFT_*` process variables: read at runtime, honoured by packaged builds
 *   too (set them in the shell / a shortcut).
 * - `MAIN_VITE_*` from `.env`: inlined by electron-vite when `npm run dev`
 *   starts, so they are only honoured in unpackaged builds and never leak a
 *   developer's local paths into an installer.
 */

/** Isolated profile dir named explicitly. Empty = the profile `profileDir` picks. */
export const userDataOverride: string =
  process.env.SIFT_USER_DATA ||
  (!app.isPackaged ? (import.meta.env.MAIN_VITE_USER_DATA_DIR ?? '') : '')

/**
 * Suffix that keeps `npm run dev` out of the installed build's profile.
 *
 * Electron derives the default profile dir from the app name, and the two names
 * differ only in case — package.json's `sift` in development, electron-builder's
 * `Sift` once packaged — which Windows does not treat as two directories. So a
 * dev session used to open the installed build's library.db, preview cache,
 * YouTube tokens and window state, and held its single-instance lock.
 */
const DEV_PROFILE_SUFFIX = ' (dev)'

/** True while the app is running on a profile that is not the installed build's. */
export const isDevProfile: boolean = Boolean(userDataOverride) || !app.isPackaged

/**
 * Where this run keeps its library, cache and window state. Call once, before
 * anything reads `app.getPath('userData')` — main/index.ts sets it at module load.
 */
export function profileDir(): string {
  if (userDataOverride) return userDataOverride
  const base = app.getPath('userData')
  return app.isPackaged ? base : base + DEV_PROFILE_SUFFIX
}

/**
 * Log per-process CPU and working set every few seconds. A `SIFT_*` knob on
 * purpose: the numbers that matter are from a packaged build with the window in
 * the tray, which is exactly where DevTools cannot be attached (and attaching it
 * would disable background throttling and invalidate the measurement anyway).
 */
export const perfLog: boolean = process.env.SIFT_PERF_LOG === '1'

/** Open Chromium DevTools as soon as the window shows (dev only). */
export const openDevTools: boolean =
  !app.isPackaged && import.meta.env.MAIN_VITE_OPEN_DEVTOOLS === 'true'

/**
 * Run the updater against `dev-app-update.yml` instead of leaving it inert, so the
 * download/install flow can be exercised without publishing a release. Dev only —
 * a packaged build always uses the real feed.
 */
export const updaterDev: boolean =
  !app.isPackaged && import.meta.env.MAIN_VITE_UPDATER_DEV === 'true'
