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

/** Isolated profile dir (separate library.db, thumbnail cache, single-instance lock). Empty = default profile. */
export const userDataOverride: string =
  process.env.SIFT_USER_DATA || (!app.isPackaged ? (import.meta.env.MAIN_VITE_USER_DATA_DIR ?? '') : '')

/** Open Chromium DevTools as soon as the window shows (dev only). */
export const openDevTools: boolean = !app.isPackaged && import.meta.env.MAIN_VITE_OPEN_DEVTOOLS === 'true'

/**
 * Run the updater against `dev-app-update.yml` instead of leaving it inert, so the
 * download/install flow can be exercised without publishing a release. Dev only —
 * a packaged build always uses the real feed.
 */
export const updaterDev: boolean = !app.isPackaged && import.meta.env.MAIN_VITE_UPDATER_DEV === 'true'
