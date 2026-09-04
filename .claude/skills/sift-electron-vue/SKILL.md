---
name: sift-electron-vue
description: Use for Sift Electron 44, electron-vite 5, Vue 3.5, and Tailwind CSS v4 work — process model, window and protocol setup, custom scheme streaming, child processes, filesystem watching, packaging, accessibility, and performance.
---

<!-- Project-scoped instruction asset. Keep this file scoped to the Sift repository. -->

# Electron 44 + electron-vite 5 + Vue 3.5 + Tailwind v4 — Sift Stack Reference

_Aligned to Electron 44, electron-vite 5, Vite 7, Vue 3.5, Tailwind CSS v4, TypeScript 5.9._

Authoritative practices for building, structuring, and maintaining this application. Where this
file and `sift-engineering` overlap, they agree; this one goes deeper on the platform.

---

## 1. The Three-Process Model

Electron runs three separate JavaScript contexts. Confusing them is the source of most Electron
bugs, and all Electron security holes.

| Process      | Runtime                | Can do                                        | Cannot do                        |
| ------------ | ---------------------- | --------------------------------------------- | -------------------------------- |
| **main**     | Node.js                | fs, child_process, shell, dialog, app, windows | Touch the DOM                    |
| **preload**  | Node + isolated world  | `ipcRenderer`, `contextBridge`                 | Reach renderer JS scope directly |
| **renderer** | Chromium, no Node      | DOM, Vue, `window.api`                         | fs, `require`, `electron`        |

- `contextIsolation: true` puts the preload script in a **separate V8 context** from page
  scripts. They share only what `contextBridge.exposeInMainWorld` copies across — and only
  structured-cloneable values plus functions.
- `sandbox: false` is set here because the preload script uses ESM imports from `@shared`.
  This is a deliberate, narrow trade: the preload script does nothing but wire channels, so
  its Node access is not an attack surface. **Do not start using Node APIs there on the
  grounds that they work.**
- The renderer must be treatable as untrusted. Write main-process code as if the renderer had
  been compromised.

### Configuring the window

`src/main/lib/window.ts` owns `BrowserWindow` creation. The security-relevant settings:

```ts
webPreferences: {
  preload: preloadPath(),
  contextIsolation: true,     // never false
  nodeIntegration: false,     // never true
  sandbox: false,             // required for the ESM preload; keep the preload trivial
  spellcheck: false           // no dictionary download, no context-menu surprises
}
```

Other choices that matter:

- `frame: false` — custom title bar. See §8.
- `show: false` plus `win.on('ready-to-show', () => win.show())` — no white flash on launch.
- `backgroundColor: '#0f0f23'` — the paint before the renderer's first frame. Keep it equal to
  `--bg-1`; a default white here is a visible flash on a dark app.
- `minWidth: 980, minHeight: 620` — below this the sidebar plus a two-column grid stops fitting.
- `setWindowOpenHandler` denies every popup and hands `http(s)` URLs to `shell.openExternal`.
  **Keep the scheme test.** Passing an unchecked URL to `openExternal` is remote code execution
  on Windows (`file:`, `ms-msdt:`, and friends). The YouTube module's own `openExternal` calls
  go through a prefix allowlist (`accounts.google.com/o/oauth2/`, `youtu.be/`) for the same reason.

### The isolated dev profile

`SIFT_USER_DATA` redirects `app.getPath('userData')`, giving a run its own `library.json`,
thumbnail cache, and single-instance lock — so a build can be tested beside a running instance
without touching the real library:

```bash
SIFT_USER_DATA=./.tmp-profile npm run dev
```

When it is set, the window title is marked `Sift (dev profile)` and a
`page-title-updated` handler `preventDefault()`s so the page cannot replace that marker. Keep
both halves — a dev profile you cannot identify at a glance is worse than none.

### Resolving the preload path

The preload output extension changes with the build mode (`.mjs` / `.js` / `.cjs`), so
`preloadPath()` probes for the first that exists rather than hardcoding one. Keep that probe if
you change the build config — a wrong preload path fails silently, and `window.api` is simply
`undefined` in the renderer.

---

## 2. electron-vite Configuration

`electron.vite.config.ts` defines three independent build targets. Each has its own plugins,
aliases, and entry point.

```ts
export default defineConfig({
  main:     { plugins: [externalizeDepsPlugin()], /* input: src/main/index.ts */ },
  preload:  { plugins: [externalizeDepsPlugin()], /* input: src/preload/index.ts */ },
  renderer: { root: 'src/renderer', plugins: [vue(), ui({ /* see sift-nuxt-ui */ })] }
})
```

Rules:

- **`externalizeDepsPlugin()` on main and preload only.** It leaves `dependencies` as runtime
  `require`/`import` rather than bundling them — which is exactly right for native and
  binary-bearing packages (`ffmpeg-static`, `@ffprobe-installer/ffprobe`, `chokidar`) and exactly
  wrong for the renderer, where everything must be bundled. Renderer-only libraries (`@nuxt/ui`,
  `motion-v`, `ogl`) sit in `devDependencies` for that reason: the renderer target inlines them,
  while anything left in `dependencies` is shipped into the asar whole, transitive tree and all.
- **`@nuxt/ui/vite` also registers the Tailwind plugin.** See §5.
- **Consequence:** anything the main process imports at runtime must be in `dependencies`, not
  `devDependencies`, or it will be missing from the packaged app. Renderer-only libraries
  (`gsap`, `vue`) belong in `devDependencies` because Vite bundles them.
- `resolve.alias` is declared **per target**. `@shared` is aliased in all three; `@` only in
  the renderer. Adding an alias to one target does not add it to the others.
- `renderer.root` is `src/renderer`, so the renderer's HTML entry, and any tool that infers
  paths from the Vite root, sees that subdirectory — not the project root. This matters for
  Tailwind source detection (see §5) and for Nuxt UI's `root` option.
- Dev uses `process.env.ELECTRON_RENDERER_URL`; production uses `loadFile` on the built HTML.
  Both paths are already handled in `window.ts` — do not add a third.
- Output goes to `out/` (`out/main`, `out/preload`, `out/renderer`), which is what
  `package.json`'s `main` field and `electron-builder.yml`'s `files` glob point at.

### ESM

The project is `"type": "module"`. In main-process code:

- Use `import.meta.dirname` (Node 20.11+), **not** `__dirname`. `window.ts` and the protocol
  handler already do.
- Use `import.meta.url` with `fileURLToPath` when you need a file URL.
- `require` is not available. A CJS-only dependency needs `createRequire`, and needs a comment
  saying why.

---

## 3. IPC

Full contract rules — channel naming, the four-file change, validation, batching — are in
`sift-engineering`. Platform-level points:

- `ipcMain.handle` + `ipcRenderer.invoke` for request/response. `send`/`on` only for
  main → renderer pushes.
- The first argument to a handler is the `IpcMainInvokeEvent`. Name it `_e` when unused, and
  **check `event.senderFrame`** if you ever load remote or third-party content (we do not, and
  should not start).
- Payloads cross a structured-clone boundary: no functions, no class instances, no `Map`/`Set`
  in a type that must survive the trip, no circular references. Send plain data.
- Never send a large binary blob over IPC. Video goes through the `clip://` protocol (§4), not
  through a channel.
- Handlers must not throw. Return `{ ok: false, error }`.
- Unregister nothing at shutdown — `ipcMain` handlers live for the app's lifetime and there is
  exactly one window.

---

## 4. The `clip://` Custom Protocol

Serving user video through a custom scheme, rather than `file://`, is what makes seeking work
and keeps the renderer from ever naming a path.

### Registration order

```ts
registerScheme()             // module scope, BEFORE app.whenReady()
// ... later, inside whenReady():
installProtocol(id => library?.clipPath(id))
```

`protocol.registerSchemesAsPrivileged` **must** run before the app is ready. Calling it late
fails silently and the scheme behaves like an unprivileged one.

Privileges granted: `standard` (so URLs parse with a hostname and origin), `secure` (treated as
a trustworthy origin), `supportFetchAPI`, `stream`, `bypassCSP`.

### URL shape and the security property

- `clip://media/<clipId>` — the renderer supplies an **id**, and the main process resolves it to
  a path through the library index. The renderer can never name an arbitrary file.
- `clip://thumb/<file>` — confined to the cache directory, and validated:
  `key === basename(key)` rejects any path separator or `..`, and the `.jpg` suffix is required.

**Preserve both properties.** If you add a route, it must resolve through an index or validate
against a fixed root. Never `join(someBase, userInput)` and serve the result.

### Range requests

`protocol.handle` receives a WHATWG `Request` and returns a `Response`. The handler:

1. `stat`s the file for its size, returning 404 if it is gone.
2. Always sets `Accept-Ranges: bytes`.
3. Parses `bytes=start-end`, including the suffix form (`bytes=-500` = last 500 bytes).
4. Clamps `end` to `size - 1`; returns **416** with `Content-Range: bytes */<size>` when the
   range is unsatisfiable.
5. Returns **206** with `Content-Range` and an exact `Content-Length`, or **200** with the full
   length when there is no range header.

Getting any of this wrong makes `<video>` seeking either slow or broken. Do not "simplify" it.

### Stream teardown

```ts
const stream = createReadStream(filePath, { ...range, highWaterMark: CHUNK })
request.signal?.addEventListener('abort', () => stream.destroy(), { once: true })
return Readable.toWeb(stream) as unknown as ReadableStream
```

The player seeks constantly, and each seek abandons the previous request. Without the abort
listener, every abandoned read drains the whole file — the app would hold dozens of open handles
and saturate the disk. **Any new streaming route must wire the same teardown.**

### Caching

- Thumbnails: `Cache-Control: private, max-age=31536000, immutable` — they are content-addressed
  and never change.
- Media: `no-store` — the file can be renamed or replaced underneath us.

### CSP

`src/renderer/index.html` carries a Content-Security-Policy meta tag, and the custom scheme has
to be named in it explicitly:

```
default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline';
img-src 'self' clip: data: blob:; media-src clip: blob:;
font-src 'self' data:; connect-src 'self' ws://localhost:* http://localhost:*
```

- `img-src`/`media-src` must list `clip:` or every thumbnail and video is blocked.
- `style-src 'unsafe-inline'` is required by Vue scoped styles and Nuxt UI's inline style
  attributes. Everything else stays locked to `'self'`.
- `connect-src` allows localhost only so the dev server's HMR websocket works; production loads
  from `file://` and needs nothing.
- **Widening this policy is a decision, not a fix.** If a change needs a remote origin, stop and
  raise it — "local-first, no network" is a product promise. The one sanctioned exception, the
  YouTube upload module, lives entirely in main (`src/main/lib/youtube/`), which is exactly why
  the policy never needed an extra origin: fetch in main, results back over IPC, remote images
  delivered as `data:` URLs. Follow that shape rather than adding a host here.

---

## 5. Styling: Tailwind CSS v4

Tailwind v4 is CSS-first: no `tailwind.config.js`, configuration lives in `@theme` blocks, and
source files are detected automatically from the CSS file's location rather than a `content`
array.

**The Tailwind Vite plugin is supplied by `@nuxt/ui/vite`, which bundles `@tailwindcss/vite`.**
Do not register `@tailwindcss/vite` separately — that puts two Tailwind plugins in one pipeline.
(`@tailwindcss/vite` is still a direct devDependency; it is unused and harmless.)

```css
/* src/renderer/src/styles/tailwind.css */
@import 'tailwindcss';
@import '@nuxt/ui';

@theme {
  --font-sans: 'Inter Variable', 'Segoe UI', system-ui, -apple-system, sans-serif;
  --font-heading: 'Chakra Petch', 'Inter Variable', system-ui, sans-serif;
  --font-display: 'Russo One', 'Chakra Petch', system-ui, sans-serif;
}
```

- Full Tailwind, **including preflight**. Preflight owns the element reset, which is why
  `base.css` no longer resets buttons beyond `cursor`. If you remove preflight, buttons and
  headings across the whole app change shape.
- The app's own CSS (`tokens.css`, `base.css`, scoped component styles) is **unlayered**, and
  unlayered styles beat layered ones in the cascade — so app styles always win over a utility
  class regardless of specificity. That is what lets Nuxt UI and the `components/bits/` copies
  keep their utility classes without fighting the design system.
- The `@theme` font declarations are what make `font-heading` usable as a utility inside a Nuxt
  UI `:ui` override. They duplicate the `--font-*` tokens in `tokens.css` — **change one, change
  both.**
- Import order in `main.ts` is `tailwind.css` → `tokens.css` → `base.css`. Keep it: the bridge in
  `tokens.css` must land after Nuxt UI's own `--ui-*` defaults.
- **Where utilities are allowed:** inside a Nuxt UI `:ui` block or `class`, and inside
  `components/bits/`. App chrome — sidebar, title bar, view headers, card internals, grid
  geometry — stays in `<style scoped>` against the tokens.
- **Do not use `@apply`.** Ever.
- Source detection starts from the CSS file and walks up, skipping `.gitignore`d paths. Since
  `renderer.root` is `src/renderer`, a utility used only in a file Tailwind does not scan will
  silently not be generated. If a class has no effect, check scanning before debugging specificity.
- Nuxt UI's generated theme templates land in `src/renderer/node_modules/.nuxt-ui/` (already
  ignored via `node_modules`). If components render unstyled, the plugin's `root` option is the
  knob — see `sift-nuxt-ui`.

---

## 6. Vue 3.5 in the Renderer

- `<script setup lang="ts">` everywhere. No Options API.
- Compiler macros (`defineProps`, `defineEmits`, `defineModel`, `defineExpose`, `withDefaults`)
  need no import.
- Type props generically; use `withDefaults` for optional ones:

```ts
const props = withDefaults(defineProps<{ name: string; size?: number }>(), { size: 18 })
```

- `useTemplateRef('name')` (3.5+) is preferred over a manually matched `ref` — `CountUp.vue`
  already uses it.
- Prefer `computed` over `watch`. Reserve `watch`/`watchEffect` for real side effects.
- **Tear down everything** registered in `onMounted` inside `onBeforeUnmount`: listeners,
  `setInterval`, `ResizeObserver`, `IntersectionObserver`, `requestAnimationFrame`, GSAP tweens,
  WebGL contexts, and `window.api.on()` (which returns its own unsubscribe function).
- `shallowRef` for large non-reactive payloads; `markRaw` for objects that must never be proxied
  (a GSAP timeline, an ogl renderer). Do not use them speculatively.
- `<Transition>`/`<TransitionGroup>` reuse the shared `fade` / `pop` / `view` classes in
  `base.css`.
- `v-html` is used in exactly one place — `Icon.vue`, rendering a hardcoded path string from a
  local constant map. **Never `v-html` anything derived from a file name, a folder name, or any
  other user-controlled value.**
- Nuxt UI `U*` components and composables are auto-imported; app components are imported
  explicitly. The generated `auto-imports.d.ts` / `components.d.ts` in `src/renderer/` are
  reached through `tsconfig.web.json`'s `src/renderer/*.d.ts` include. Never hand-edit them.
- `defineAsyncComponent` keeps a heavy conditional dependency out of the main chunk —
  `LibraryView` loads `bits/Aurora.vue` this way so `ogl` ships only when the empty state
  actually renders. Use it for any similarly heavy, rarely-shown component.
- There is no router. Screens are switched by the `view` / `screen` refs in `useLibrary`. Do not
  add `vue-router`.

---

## 7. Filesystem: Scanning and Watching

### Scanning

`scanner.ts` walks a folder for files whose extension is in `VIDEO_EXTENSIONS`. Scans are
serialised through a promise chain (`scanChain`) so two folders never walk concurrently and
fight for disk.

### Watching

`watcher.ts` wraps chokidar with settings tuned for recorders:

```ts
{
  ignoreInitial: true,
  depth: 8,
  awaitWriteFinish: { stabilityThreshold: 2500, pollInterval: 500 },
  ignored: (p, stats) => /* dotfiles, temp files, non-video */
}
```

- **`awaitWriteFinish` is essential.** ShadowPlay keeps writing while it muxes; without it we
  would probe a half-written file and cache a broken thumbnail. Do not lower the threshold to
  make new clips appear faster.
- `depth: 8` bounds the recursion. A user pointing at a drive root must not spawn unbounded
  watchers.
- The `ignored` predicate rejects dotfiles, `~`-prefixed temp files, and non-video files *before*
  chokidar emits — cheaper than filtering downstream.
- `watcher.on('error')` is swallowed deliberately: a transient permission error on one path must
  not tear the app down.
- One watcher per folder, tracked in a `Map`, and **closed** in `shutdown()`. A leaked watcher
  keeps the process alive after the window closes.

### Filesystem operations

- Async `node:fs/promises` in all hot paths. `mkdirSync` at startup only (`ensureDirs`).
- Rename in place with `fs.rename`. Validate the new name against `[<>:"/\|?*]` first — Windows
  rejects those, and a path separator would be a directory escape.
- Delete via `shell.trashItem` (Recycle Bin). **Never `fs.unlink` a user's video.**
- Removing a folder from the library removes the index entry only; the files are untouched.
- A missing drive sets `folder.available = false` and **keeps** the clips. Do not prune them.

---

## 8. The Frameless Window

`frame: false` means we draw the title bar. `TitleBar.vue` owns it, at `--titlebar-h` (40px).

- The draggable region is `-webkit-app-region: drag`. **Every interactive element inside it must
  set `-webkit-app-region: no-drag`**, or it cannot be clicked.
- Maximise state comes from the main process: `win.on('maximize' | 'unmaximize')` sends
  `window:maximized`. Do not infer it from the window size in the renderer.
- Window controls go through `window.api.window.*`. Match Windows conventions: minimise,
  maximise/restore, close, in that order, at the top right, with a red close hover.
- Double-clicking the drag region should toggle maximise.
- Keep the drag region clear of the scroll container; a drag region over content swallows
  text selection and clicks.

---

## 9. Child Processes and the Media Pipeline

Full rules in `sift-engineering` §Main-Process Rules. Platform specifics:

- `spawn`, never `exec` — `exec` goes through a shell and takes a string, which is a command
  injection vector with a user-controlled file path in it. `spawn` with an argument array does not.
- `windowsHide: true` on every spawn, or a console window flashes on screen.
- `setPriority(pid, PRIORITY_BELOW_NORMAL)` immediately after spawn, wrapped in try/catch —
  it can fail without being fatal.
- `stdio: ['ignore', 'pipe', 'pipe']` and **drain stderr**. An undrained pipe fills its buffer
  and deadlocks the child.
- A kill timer on every job (`JOB_TIMEOUT_MS`, 60s), always cleared in both the `close` and
  `error` paths.
- Binaries come from `ffmpeg-static` / `@ffprobe-installer/ffprobe` and are rewritten by
  `paths.ts`:

```ts
function unpacked(p: string): string {
  return p.includes('app.asar.unpacked') ? p : p.replace('app.asar', 'app.asar.unpacked')
}
```

  The guard is not decoration: `'app.asar.unpacked'` contains `'app.asar'`, and which of the two
  a package reports depends on how it resolves itself (`__dirname` vs `require.resolve`).

  In a packaged build the ASAR archive is not a real directory, so the binary must be read from
  `app.asar.unpacked`. This pairs with `asarUnpack` in `electron-builder.yml` — **change one and
  you must change the other.**

---

## 10. Packaging (electron-builder 26)

`electron-builder.yml` controls the Windows NSIS installer.

- `files` ships `out/main`, `out/preload`, `out/renderer` and `package.json` only. Everything else
  is pulled in as a resolved dependency; nothing from `src/` reaches the installer, and neither do
  the bundled test/release scripts that a bare `out/**` would sweep in.
- Prefer binary packages that ship one platform per optional dependency (`@ffprobe-installer/*`):
  npm then installs only the one this build needs. A package that puts every platform in one
  tarball is paid for on every install and needs explicit `!` exclusions to stay out of the asar.
- `asarUnpack` covers `ffmpeg-static` and `@ffprobe-installer`. Any new spawned binary needs an
  entry here **and** the `unpacked()` treatment in `paths.ts`.
- `npmRebuild: false` — there are no native modules to rebuild. If a native dependency is ever
  added, this must change and the postinstall story must be re-tested.
- `appId: com.sift.app` must match `electronApp.setAppUserModelId()` in `main/index.ts`, or
  Windows taskbar grouping and notifications break.
- NSIS is configured non-one-click with a user-selectable directory and per-user install
  (`perMachine: false`) — no elevation prompt.
- Verify with `npm run build:unpack` before `npm run build:win`. The unpacked folder catches
  missing-binary and wrong-path bugs faster than a full installer.

### Things that only break in a packaged build

Test these against `build:unpack`, never dev alone:

- ffmpeg/ffprobe resolution (the ASAR path rewrite)
- the preload path probe
- `loadFile` vs `ELECTRON_RENDERER_URL`
- the icon (`build/icon.png` exists on disk in dev; the installer bakes it into the exe)
- `app.getPath('userData')` pointing at the real `%APPDATA%/sift`

---

## 11. Performance

Beyond the app-level rules in `sift-engineering`:

- **Startup:** `show: false` + `ready-to-show`, and `backgroundColor` matching the app ground.
  Do not add synchronous work between `whenReady` and window creation — `ensureDirs()` is the
  only sync call, and it is one `mkdirSync`.
- **Main-thread discipline:** the main process is single-threaded and also drives IPC and window
  events. A synchronous `readFile` on a 4GB video freezes the whole app.
- **GPU:** `app.commandLine.appendSwitch('enable-features', 'PlatformHEVCDecoderSupport')` lets
  Chromium use the GPU's HEVC decoder for ShadowPlay recordings that need it. Do not remove it;
  do not add unrelated switches without measuring.
- **Memory:** one window, one library `Map`, streamed video. Never buffer a clip into a
  `Uint8Array` or a data URL.
- **DOM:** the grid is windowed. The DOM node count must stay flat as the library grows.
- **Reactivity:** the clip `Map` stays outside Vue's proxy; a `version` counter drives computeds.
- **Compositor:** transform/opacity only. See `sift-motion`.

State what got faster and how you measured it when you touch any of these.

---

## 12. Accessibility (WCAG 2.2 AA)

A desktop app is not exempt. It also has no browser chrome to fall back on, so keyboard access
is the *only* alternative to the mouse.

### Structure and semantics (MUST)

- One `<main>` for the content area; `<nav>` for the sidebar; `<h1>`–`<h4>` in order.
- Real `<button>` for anything clickable. `body` sets `cursor: default` and
  `user-select: none`, so a clickable `<div>` gets no affordance for free.
- Lists are `<ul>`/`<li>`. The clip grid's virtualisation must not break the accessibility tree —
  if a row's semantics are lost to absolute positioning, add the right `role` and
  `aria-rowcount`/`aria-setsize` so assistive tech still knows the real totals.

### Keyboard and focus (MUST)

- Everything interactive is reachable by `Tab` in a sensible order, and operable with
  `Enter`/`Space`.
- `:focus-visible` is the visible indicator. `base.css` clears the plain `:focus` outline —
  **never clear `:focus-visible` too.**
- Overlays (player, dialogs, context menu) trap focus, close on `Esc`, and **restore focus to
  the element that opened them**.
- The background gets `inert` while an overlay is open — `App.vue` already does this for the
  player. `inert` removes it from the tab order and the accessibility tree in one attribute.
- The player's shortcut table in `README.md` is a contract. Every key in it must keep working,
  and none of them may fire while focus is in a text field.
- Provide a visible way to do anything that is currently hover-only (hover-to-scrub, hover
  action buttons) — hover is not an input method for keyboard users.

### ARIA (MUST)

- Prefer a native element over a `role`.
- Icon-only buttons need `aria-label` or `.sr-only` text. `Icon.vue` marks its SVG
  `aria-hidden="true"` precisely so the name lives on the control.
- Toggle state through `aria-pressed` / `aria-checked`, and drive the visual state off that
  attribute (as `.toggle` does) so the two cannot drift.
- `aria-live="polite"` for scan progress and toasts; never `assertive` for routine updates.
- Do not put `aria-*` on an element that already communicates the same thing natively.

### Contrast (MUST)

- 4.5:1 for body text, 3:1 for large text and meaningful UI boundaries — measured against the
  actual surface token behind the element, not against `#000`.
- Text over a thumbnail needs a scrim or a `.badge`-style opaque plate. A duration label over an
  arbitrary video frame has no guaranteed contrast without one.
- `--fg-dim` is the floor. Nothing dimmer, and nothing task-critical in it.
- Never signal state with colour alone.

### Forms and input (MUST)

- Every input has a visible `<label>` or an `aria-label`. Placeholder text is not a label.
- Errors sit next to the field they belong to, in text, not colour alone.
- Inputs must opt back into `user-select: text`.
- Disabled controls (`.btn:disabled`) get `cursor: not-allowed` and reduced opacity — and must
  still explain *why* they are disabled somewhere the user can see.

### Motion (MUST)

- `prefers-reduced-motion` is honoured through `useMotion` → `html.no-motion`. Nothing may
  bypass it. See `sift-motion`.

### Reflow (MUST)

- The window minimum is 980×620. Between that and maximised, no horizontal scrolling, no
  clipped controls, and no overlapping text at any size.
- There is no mobile breakpoint and none is needed — but the layout must be fluid between the
  minimum and a large display.

### Verification checklist

- [ ] `Tab` through every screen — order sensible, focus always visible
- [ ] Every action reachable without a mouse
- [ ] `Esc` closes every overlay and returns focus to the trigger
- [ ] Screen reader announces control names and states (Narrator or NVDA)
- [ ] Contrast checked against the real surface token
- [ ] Verified with Animations off and OS reduced-motion on
- [ ] Verified at 980px wide and maximised

---

## 13. Tooling

```bash
npm install          # deps + electron-builder install-app-deps
npm run dev          # electron-vite dev, HMR in the renderer
npm run typecheck    # typecheck:node + typecheck:web — both must pass
npm run build        # typecheck + build all three targets to out/
npm run build:unpack # unpacked app for a real-world smoke test
npm run build:win    # NSIS installer into dist/
```

- **`npm run typecheck` is the gate.** `typecheck:node` covers main + preload + shared;
  `typecheck:web` runs `vue-tsc` over the renderer + shared. A `preload`/`Api` mismatch fails only
  one of them, so both must run.
- The renderer hot-reloads. **Main and preload changes need a restart** — electron-vite restarts
  the app on main-process changes, but if behaviour looks stale, restart `npm run dev`.
- Three artefacts are **generated** and must never be hand-edited: `src/renderer/auto-imports.d.ts`,
  `src/renderer/components.d.ts`, and `src/renderer/node_modules/.nuxt-ui/`. The first two are
  regenerated by the dev server; a stale one shows up as a `U*` component typed `any`. The
  `.nuxt-ui` directory is covered by the `node_modules` line in `.gitignore`; the two `.d.ts`
  files are not currently ignored, so decide deliberately whether to commit them when the repo is
  initialised (committing them keeps a fresh clone type-checking before its first `dev` run).
- Use `SIFT_USER_DATA=<dir>` to run against a throwaway library (see §1).
- There is no ESLint or Prettier configuration in this project. Match the surrounding style by
  reading the neighbouring file: 2-space indent, no semicolons, single quotes, trailing-comma-free
  argument lists, `type` imports separated (`import type { … }`).
- To confirm a change in the running app, ask the user to reload (`Ctrl+R`) or restart the dev
  server and describe what to look for. **Do not drive their live application window with
  synthetic input.**

---

## 14. Always Verify Against the Installed Version

Electron, Vue, and Tailwind all change fast, and this project pins recent majors
(Electron 44, Vue 3.5, Tailwind 4, Vite 7, electron-vite 5).

- Check `package.json` for the actual version before relying on an API.
- When an API's shape matters, read it in `node_modules` — the installed `.d.ts` is the truth,
  and it is right there.
- Prefer the official docs (electronjs.org, vuejs.org, tailwindcss.com,
  electron-vite.org) over blog posts and older answers, which are frequently written against
  Electron's pre-`contextIsolation` era and will steer you into removing exactly the settings
  §1 requires.
