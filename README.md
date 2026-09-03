# Sift

A local-first clip library for NVIDIA ShadowPlay (and any other recorder) — Electron + electron-vite + Vue 3, dark mode only.

- **Index in place.** Point it at the folder your recorder saves to. Nothing is copied or moved.
- **Games first.** ShadowPlay writes `Videos\<Game>\clip.mp4`; each sub-folder becomes a game. The home screen is a searchable games browser (newest clip as cover, clip count, total length/size); open a game to get its clips grouped by date or flat.
- **Watch folders.** New recordings appear seconds after they finish writing.
- **Previews.** Poster frames plus hover-to-scrub strips, rendered once by a bundled ffmpeg at below-normal CPU priority and cached in `%APPDATA%\sift\thumbs`.
- **Player.** Custom controls, keyboard shortcuts, prev/next through the grid, autoplay-next, loop, speed, fullscreen.
- **Manage.** Rename or delete (to Recycle Bin) from the grid or the player; show in Explorer.

## Run

```bash
npm install
npm run dev
```

## Configuration

Optional. Copy `.env.example` to `.env` (git-ignored) and set what you need; restart `npm run dev` afterwards because electron-vite inlines the values at start-up.

| Variable | Where it's read | Effect |
| --- | --- | --- |
| `MAIN_VITE_USER_DATA_DIR` | `.env`, dev builds only | Run against an isolated profile (own `library.db`, thumbnail cache, single-instance lock) — test a build next to a running install without touching its library |
| `MAIN_VITE_OPEN_DEVTOOLS` | `.env`, dev builds only | `true` opens detached DevTools when the window appears |
| `SIFT_USER_DATA` | shell environment, any build | Same profile override, but honoured by packaged builds too (`$env:SIFT_USER_DATA = "D:\sift-test"; npm run dev`) |

Only `MAIN_VITE_*` / `PRELOAD_VITE_*` / `RENDERER_VITE_*` / `VITE_*` names reach the bundles; anything else in `.env` is ignored. `src/main/env.d.ts` types the ones the main process reads.

## Build a Windows installer

```bash
npm run build:win
```

Output lands in `dist/`. `npm run build:unpack` produces an unpacked folder for a quick test.

## Keyboard (player)

| Key | Action |
| --- | --- |
| Space / K | Play / pause |
| ← → | Seek 5 s · J / L seek 10 s |
| ↑ ↓ | Volume · M mute |
| 0–9 | Jump to 0–90 % |
| N / P | Next / previous clip |
| F | Fullscreen · Esc back |

## Layout

```
src/main       Electron main: library store, scanner, ffmpeg queue, watchers, clip:// protocol, IPC
src/preload    contextBridge API (window.api)
src/renderer   Vue app — composables hold state, components are presentational
src/shared     Types shared across all three
design-system/ Design tokens generated with ui-ux-pro-max (see .claude/skills)
```

### Nuxt UI

The component layer is [Nuxt UI v4](https://ui.nuxt.com) running on plain Vue through its Vite plugin (`router: false`, `colorMode: false`, forced `.dark`). Buttons, inputs, selects, switches, badges, tooltips (with keyboard hints), breadcrumb, vertical navigation menu, progress, skeletons, modal dialogs, the clip context menu, empty states, alerts and toasts all come from it. Its `--ui-*` design variables are re-pointed at the app palette in `tokens.css`, so every component matches the design system without per-component overrides. Lucide icons are bundled at build time via the plugin's icon scanner — nothing is fetched at runtime.

### Vue Bits

Animated pieces come from [Vue Bits](https://vue-bits.dev) and live as editable copies in `src/renderer/src/components/bits/` (the jsrepo model — each file notes its source and any adaptation). Tailwind v4 is provided by the Nuxt UI plugin; app styles stay unlayered and always win over utilities.

| Component | Where | Notes |
| --- | --- | --- |
| SplitText | screen titles | GSAP SplitText; `immediate` skips ScrollTrigger |
| CountUp | header stats | patched to re-animate when the count changes live |
| ShinyText | wordmark | motion-v |
| BlurText | empty-state heading | motion-v, `tag` prop |
| AnimatedList + SpotlightCard | games browser | generic slot list with ↑↓/Enter; Tab hijack removed |
| ElasticSlider | player volume | v-model added |
| Folder, StarBorder, Aurora (ogl) | empty state only | Aurora is WebGL — mounted only while the hero is on screen |

All of them respect the Animations toggle / reduced-motion (they render static or unmount).

### Efficiency notes

- The grid is windowed: only rows on screen (plus a small overscan) exist in the DOM, so a 5,000-clip library renders like a 50-clip one.
- Clip state lives in a plain `Map`; a version counter drives Vue's computed lists instead of deep-proxying thousands of objects.
- Main → renderer updates are batched every 150 ms.
- ffmpeg jobs run with bounded concurrency (default 2, configurable), `-threads 1`, and below-normal process priority. Sprite strips use keyframe seeks stitched with `hstack` rather than decoding whole files.
- Video streams through a custom `clip://` protocol with HTTP range support; read streams are torn down the moment Chromium abandons a request.
- All animation is transform/opacity only, and every transition collapses to instant when Windows asks for reduced motion or the setting is off.
