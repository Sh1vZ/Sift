---
name: sift-nuxt-ui
description: Use when working with Nuxt UI v4 components in the Sift renderer — buttons, tooltips, badges, selects, modals, context menus, navigation, empty states, toasts, icons — including the electron-vite plugin config, the token bridge, and the ToastBridge pattern.
---

<!-- Project-scoped instruction asset. Keep this file scoped to the Sift renderer. -->

# Nuxt UI in Sift

## Status: wired and in production use

Nuxt UI v4 is **the component layer of this app**, not an optional add-on. Roughly 130 usages
across 20 component types. Buttons, inputs, selects, switches, badges, tooltips, breadcrumb,
navigation menu, progress, skeletons, modals, the clip context menu, empty states, alerts and
toasts all come from it.

The hand-rolled CSS primitives that used to live in `base.css` (`.btn`, `.input`, `.segmented`,
`.select`, `.toggle`, `.badge`, `.pill`, `.icon-btn`) **have been deleted**. Do not reintroduce
them. `base.css` is now resets, four helpers, and the shared Vue transitions.

---

## Current Configuration

### `electron.vite.config.ts` (renderer target)

```ts
import ui from '@nuxt/ui/vite'

plugins: [
  vue(),
  ui({
    router: false,
    colorMode: false,
    ui: {
      colors: {
        primary: 'violet',
        secondary: 'fuchsia',
        success: 'emerald',
        info: 'sky',
        warning: 'amber',
        error: 'rose',
        neutral: 'slate'
      },
      button: {
        slots: { base: 'font-heading font-semibold uppercase tracking-wider cursor-pointer' }
      }
    },
    icon: { mode: 'svg', clientBundle: { scan: true, sizeLimitKb: 512 } }
  })
]
```

Why each option is what it is:

- **`@tailwindcss/vite` is NOT registered separately.** `@nuxt/ui/vite` bundles it. Adding it
  back gives you two Tailwind plugins in one pipeline. (`@tailwindcss/vite` remains an unused
  direct devDependency — harmless, but do not re-add the plugin call.)
- **`router: false`** — there is no `vue-router`. Links render as plain anchors.
- **`colorMode: false`** — dark-only. `<html class="dark">` is hardcoded in
  `src/renderer/index.html`; nothing toggles at runtime.
- **`ui.button.slots.base`** carries the house button style globally: Chakra Petch, semibold,
  uppercase, wide tracking, `cursor-pointer`. This is why buttons look like Sift without
  per-instance classes. **New global style rules go here, not into 30 call sites.**
- **`icon.clientBundle.scan: true`** bundles only the `i-lucide-*` names actually referenced,
  at build time. Nothing is fetched at runtime.
- **No `root` option.** The generated theme templates land in
  `src/renderer/node_modules/.nuxt-ui/`, already covered by the `node_modules` line in
  `.gitignore`. If Nuxt UI components ever render unstyled, `root` is the knob — it controls
  where those templates are written relative to what Tailwind scans.

### Stylesheet — `src/renderer/src/styles/tailwind.css`

```css
@import 'tailwindcss';
@import '@nuxt/ui';

@theme {
  --font-sans: 'Inter Variable', 'Segoe UI', system-ui, -apple-system, sans-serif;
  --font-heading: 'Chakra Petch', 'Inter Variable', system-ui, sans-serif;
  --font-display: 'Russo One', 'Chakra Petch', system-ui, sans-serif;
}
```

- Full Tailwind **including preflight**. Preflight now owns the element reset, which is why
  `base.css` no longer resets buttons beyond `cursor`.
- The `@theme` fonts are what make `font-heading` work as a utility inside `:ui` overrides.
- App CSS (`tokens.css`, `base.css`, scoped component styles) is **unlayered**, and unlayered
  beats layered, so app styles always win over a utility class regardless of specificity.
- Import order in `main.ts` is `tailwind.css` → `tokens.css` → `base.css`. Keep it.

### Bootstrap — `src/renderer/src/main.ts`

```ts
import ui from '@nuxt/ui/vue-plugin'   // virtual module, supplied by the Vite plugin
createApp(App).use(ui).mount('#app')
```

### Root wrapper — `App.vue`

```vue
<UApp :toaster="{ position: 'bottom-right', duration: 4500, expand: true }"
      :tooltip="{ delayDuration: 250 }">
  <ClickSpark ...>
    <div class="app"> … </div>
  </ClickSpark>
</UApp>
```

`UApp` provides the tooltip, overlay, and toaster contexts. It is **outside** `ClickSpark` so
portalled overlays are not clipped by the spark canvas. Do not move it or add a second one.

---

## The Token Bridge

**One direction only.** Nuxt UI's `--ui-*` variables are re-pointed at Sift tokens in
`tokens.css`, so components inherit the palette with no per-component colour work:

```css
:root,
.dark {
  --ui-bg: var(--bg-1);
  --ui-bg-muted: var(--bg-2);
  --ui-bg-elevated: var(--bg-3);
  --ui-bg-accented: var(--bg-4);
  --ui-bg-inverted: var(--fg);
  --ui-border: var(--border);
  --ui-border-muted: var(--border);
  --ui-border-accented: var(--border-hover);
  --ui-border-inverted: var(--fg);
  --ui-text-dimmed: var(--fg-dim);
  --ui-text-muted: var(--fg-muted);
  --ui-text-toned: #b4c0d3;
  --ui-text: var(--fg);
  --ui-text-highlighted: #f8fafc;
  --ui-text-inverted: var(--fg-inverse);
  --ui-primary: var(--ui-color-primary-500);
  --ui-radius: 0.5rem;
}
```

- `--ui-radius: 0.5rem` drives Nuxt UI's whole radius scale (`sm` 8px, `md` 12px, `lg` 16px),
  sitting a step above the app's own `--r-md` 10px / `--r-lg` 14px.
- `--ui-primary` resolves to **violet-500** (`#8b5cf6`), which equals the app's
  `--primary-hover`, not `--primary` (violet-600). Nuxt UI surfaces therefore read one step
  brighter than a hand-styled surface. Deliberate — Nuxt UI applies it mostly to small accents
  and `soft`/`subtle` fills where violet-600 goes muddy.
- **`--ui-*` names appear in `tokens.css` and nowhere else.** In a component, write
  `var(--bg-3)`, `var(--fg)`, `var(--primary)`.
- The `.dark` selector is there defensively; with `colorMode: false` nothing toggles it, but
  the class is on `<html>` so both selectors match.

### The `error` / `--destructive` divergence

Nuxt UI's `error` is mapped to **rose**, while the app token `--destructive` is **red-500**
(`#ef4444`) and `--accent` is rose-500. So `<UButton color="error">` renders rose, and the one
place still using the raw token — the title bar close-button hover — renders red.

Live with it, but know which you are reaching for: **use `color="error"` for anything Nuxt UI
renders**, and only use `var(--destructive)` in scoped CSS on non-Nuxt-UI chrome. Do not
"harmonise" one into the other without checking every destructive surface in both.

---

## Component Vocabulary

Keep the app coherent by staying inside the vocabulary already in use:

| Prop      | In use                                                        |
| --------- | -------------------------------------------------------------- |
| `color`   | `neutral` (21) · `primary` (14) · `error` (3) · `warning` (1)  |
| `variant` | `ghost` (16) · `subtle` (7) · `soft` (6) · `pill` (2) · `link` (2) |

- **`ghost`** for toolbar and overlay icon buttons.
- **`subtle` / `soft`** for the inactive / active pair in a segmented `UFieldGroup`.
- **`solid`** is not used anywhere. Do not introduce it without a reason — the app's emphasis
  comes from colour and surface, not from filled buttons.
- Icon-only buttons take `square` plus a size, and **always** an `aria-label`.

### Adoption map — what is in use, and for what

| Component        | Used for                                                              |
| ---------------- | --------------------------------------------------------------------- |
| `UButton`        | Every button, including window controls and player transport           |
| `UTooltip`       | Icon-button labels; `:kbds="['Esc']"` shows the shortcut in the player |
| `UBadge`         | Card overlays (resolution, duration), section counts, scan status      |
| `UIcon`          | Standalone icons inside Nuxt UI layouts                                |
| `USelect`        | Sort order, preview-worker count                                       |
| `UKbd`           | Keyboard hints                                                         |
| `UEmpty`         | Empty states, with `:actions` for the inline call to action            |
| `UNavigationMenu`| Sidebar nav, `orientation="vertical" variant="pill" highlight`         |
| `UInput`         | Text entry (rename prompt, search)                                     |
| `UFieldGroup`    | Segmented controls — a group of `UButton`s with `:aria-pressed`        |
| `UContextMenu`   | Right-click menu per clip card                                         |
| `UApp`           | Root provider                                                          |
| `USwitch`        | Settings toggles                                                       |
| `USkeleton`      | Thumbnail placeholder while a clip is `probeState: 'pending'`          |
| `UProgress`      | Scan/preview activity in the sidebar                                   |
| `UModal`         | `DialogHost` — confirm and prompt                                      |
| `UFormField`     | Label + control pairing inside the prompt dialog                       |
| `UCard`          | Settings group container                                               |
| `UBreadcrumb`    | Title-bar trail                                                        |
| `UAlert`         | Inline warnings (unavailable folder)                                   |

**Not adopted, and not to be adopted without a strong case:** `UTable` (the grid is windowed by
`useVirtualGrid` — this is load-bearing), `UCarousel`, `UForm`, the Tiptap editor family, and
the chat / prose / content / dashboard / marketing families. None of them fit a local desktop
clip library, and several drag in peer dependencies the app does not ship.

---

## Auto-Imports

Component and composable auto-imports are **on** (the plugin bundles `unplugin-vue-components`
and `unplugin-auto-import`).

- `U*` components need **no import** in an SFC. Follow that — do not add explicit imports for
  them; it is inconsistent with every existing file.
- App components (`ClipCard`, `Sidebar`, `bits/*`) **are** imported explicitly. Keep doing that:
  an explicit import is how a reader tells app code from library code at a glance.
- Composables like `useToast` are imported explicitly from `@nuxt/ui/composables`.
- `src/renderer/auto-imports.d.ts` and `src/renderer/components.d.ts` are **generated**. Never
  hand-edit them. `tsconfig.web.json` includes them via `"src/renderer/*.d.ts"`; if a `U*`
  component types as `any`, the dts is stale — restart `npm run dev`.
- Do not register your own instance of either unplugin. The Nuxt UI plugin throws on a duplicate.

---

## Toasts: the ToastBridge pattern

This is the one genuinely non-obvious bit of wiring in the app. **Read it before touching
notifications.**

Nuxt UI's `useToast()` must run inside a component's setup context. But Sift raises toasts
from module-scope composables (`useLibrary.addFolder`, `deleteClip`, …), which have no such
context. So:

1. `composables/useToasts.ts` exposes `toast(kind, title, message?)`, which pushes onto a
   `pending` ref queue and nothing more.
2. `components/ToastBridge.vue` — mounted **inside `<UApp>`** — calls `useToast()`, watches
   `pending`, and forwards each queued item to the real toaster with a colour and an
   `i-lucide-*` icon per kind.

Rules:

- **`toast()` from `useToasts` stays the only entry point** for app code. Never call
  `useToast()` outside `ToastBridge`.
- A new toast kind is a three-line change in `ToastBridge`: add it to `ToastKind`, the `color`
  map, and the `icon` map.
- Toaster position and duration are configured once on `<UApp>`, not per toast.
- `drain()` empties the queue as it forwards; do not read `pending` for any other purpose.

---

## Overriding Styles

Three mechanisms, in order of preference:

1. **The `ui` block in the Vite plugin config** — for a rule that should apply to every
   instance. `button.slots.base` is the precedent.
2. **The `:ui` prop** — slot-keyed Tailwind classes for one usage. This is the house mechanism;
   ~13 usages across 7 components:

```vue
<UBreadcrumb
  :items="crumbs"
  :ui="{
    link: 'text-xs font-heading font-semibold uppercase tracking-wider gap-1.5',
    linkLeadingIcon: 'size-3.5',
    separatorIcon: 'size-3 text-dimmed'
  }"
/>
```

3. **A scoped class via `class`** — when the override is layout or needs a token. The title bar
   window controls do this (`class="wc"` overrides width/radius/colour on a `UButton`).

Never fork a `U*` component into `components/` to restyle it, and never edit anything under
`node_modules`.

### Tailwind utilities

Utilities are legitimate **inside `:ui` blocks and in `class` on Nuxt UI components**
(`w-44`, `size-4`, `animate-spin`, `text-dimmed`, `font-heading`). That is how Nuxt UI is meant
to be tuned.

They remain **out of bounds for app chrome** — `.sidebar`, `.titlebar`, `.view`, card internals,
grid geometry — which stays in `<style scoped>` against the tokens. The line is: *tuning a Nuxt
UI component → utilities; laying out the app → scoped CSS.*

---

## Icons

Two systems coexist deliberately:

- **`i-lucide-*`** — the Iconify name every Nuxt UI `icon` / `leading-icon` / `trailing-icon`
  prop takes, and `UIcon`. Build-time bundled. ~40 names in use. **This is the default for
  anything Nuxt UI renders.**
- **`Icon.vue`** — a trimmed inline Lucide path map (78 lines), still used by `ClipCard`,
  `LibraryView`, `GamesBrowser`, and `FoldersView` for icons inside hand-built markup where
  pulling in `UIcon` would add nothing.

Rules:

- Nuxt UI component → `i-lucide-*`. Hand-built markup → `Icon.vue`.
- Same visual family both ways: Lucide, 24×24 viewBox, 2px stroke.
- Adding a glyph to `Icon.vue` means pasting its Lucide path into the `ICONS` map. Do not import
  an icon library to do it.
- Never install a second collection; never fetch an icon at runtime. The CSP in `index.html`
  would block it anyway.
- Emoji are not icons.

---

## Motion

Nuxt UI ships CSS transitions and Reka UI data-state keyframes. Both are covered by the motion
gate: `html.no-motion *` in `tokens.css` forces `transition-duration` and `animation-duration`
to `0.001ms !important` on every element, so Nuxt UI motion collapses with everything else when
Animations are off. This is verified in the running app.

- Keep Nuxt UI timings consistent with the table in `sift-motion`; override an overlay
  transition that feels slower than the app's 220ms `pop`.
- Spinners inside a `:ui` override use Tailwind's `animate-spin` (see the title-bar scan badge);
  the `.spin` helper in `base.css` is for hand-built markup. Both collapse under `no-motion`.
- Do not layer `motion-v` on top of a Nuxt UI component — it already has a transition.

---

## Adoption Workflow

For a component not yet in the map:

1. Confirm it is not one of the excluded families above.
2. Check its current props and slots at <https://ui.nuxt.com> — do not write the API from memory.
3. Use it with no import (auto-import), inside the existing colour/variant vocabulary.
4. Theme through the bridge. No hex, no `--ui-*` names, no new colour aliases in a template.
5. Verify keyboard parity: focus trap, `Esc`, focus restoration to the trigger, arrow-key
   navigation, and `inert` on the background for a full-screen overlay.
6. Verify with Animations **off**.
7. If it needs a global style rule, add it to the `ui` block in the Vite config rather than
   repeating a `:ui` override.
8. Run `npm run typecheck` — a stale `components.d.ts` shows up here first.

---

## Do Nots

- ❌ Do not re-add `@tailwindcss/vite` to the renderer plugins — `@nuxt/ui/vite` includes it
- ❌ Do not register your own `unplugin-vue-components` or `unplugin-auto-import`
- ❌ Do not enable `router` or `colorMode`, or add a light palette
- ❌ Do not reintroduce the deleted `.btn` / `.input` / `.segmented` / `.toggle` / `.pill` primitives
- ❌ Do not put a `--ui-*` name or a Nuxt UI colour alias in a component — they live in `tokens.css`
- ❌ Do not add explicit imports for `U*` components; they are auto-imported
- ❌ Do not hand-edit `auto-imports.d.ts` or `components.d.ts`
- ❌ Do not call `useToast()` anywhere but `ToastBridge.vue` — app code calls `toast()`
- ❌ Do not fork a `U*` component into `components/`, or edit `node_modules`
- ❌ Do not use `UTable` for the clip grid — `useVirtualGrid` owns it
- ❌ Do not use Tailwind utilities for app chrome layout — scoped CSS and tokens
- ❌ Do not use `i-lucide-*` outside a Nuxt UI icon prop
- ❌ Do not introduce `variant="solid"` or a new colour alias without a stated reason
- ❌ Do not add a second `UApp`, or move it inside `ClickSpark`
