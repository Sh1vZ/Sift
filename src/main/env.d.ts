/**
 * Variables electron-vite inlines into the main bundle from `.env`
 * (only the `MAIN_VITE_` / `VITE_` prefixes reach this process).
 * Keep this in sync with `.env.example`.
 */
interface ImportMetaEnv {
  readonly MAIN_VITE_USER_DATA_DIR?: string
  readonly MAIN_VITE_OPEN_DEVTOOLS?: string
}
