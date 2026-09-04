---
name: sift-design-system
description: Use for Sift UI, layout, components, styling, loading and empty states, interaction states, accessibility, and visual consistency with the dark-only Sift design system.
---

<!-- Project-scoped instruction asset. Keep this file scoped to the Sift renderer. -->

# Design System Instructions

## Required Design Source

- Before generating or editing renderer UI, layout, styling, interaction, or component-polish
  code, read `design-system/sift/MASTER.md`.
- If `design-system/sift/pages/<page>.md` exists for the screen you are building, its
  rules **override** `MASTER.md`.
- `MASTER.md` records the generated design *intent*. `src/renderer/src/styles/tokens.css` and
  `styles/base.css` are the *implementation source of truth*. Where they disagree, the CSS
  wins and the "Deviations" section below explains why. Never "fix" the CSS to match a
  MASTER.md value without checking that list first.

## Overview

Sift is a **dark-only Electron desktop app**. There is no light theme. `<html class="dark">`
is hardcoded, `color-scheme: dark` is set on `:root`, and Nuxt UI runs with `colorMode: false`.
Do not add `dark:` variants, `prefers-color-scheme` branches, or a light palette — they are
dead weight here.

There **is** a small set of dark **themes** (`Settings.theme`, picked in Settings → Themes):
`sift` (default), `ember`, `arctic`, `synthwave`, `verdant`, `crimson`, `solar`, and the
true-black `oled`, `oled-mint`, `oled-frost`, `oled-crimson`. A theme is one `html[data-theme]`
block in `tokens.css` that re-points only the surface, text and brand tokens (plus the
`--ui-color-primary-*` shades so Nuxt UI follows). Typography, spacing, radius and motion never
change with the theme. `composables/useTheme.ts` sets the attribute and carries a `THEMES`
table whose hexes mirror the CSS for previews and for Vue Bits props that take a colour
string. **This is why raw brand hexes are banned in components**: anything that must look
purple in the default theme must read `var(--primary)` / `var(--secondary)` / `var(--accent)`
(use `color-mix(in srgb, var(--primary) 45%, transparent)` for alpha variants), or take its
colour from `activeTheme.colors`. Text or glyphs on a `--primary` fill use `--on-primary`, not
`#fff` — the golden `solar` theme flips it dark. The token values quoted below are the default
theme's.

Icons named in `.ts` files (the settings rail table) are only bundled because
`electron.vite.config.ts` widens the Nuxt UI icon scan to include `.ts`; keep that glob.

The visual language is a gaming-adjacent dark chrome: deep indigo-black surfaces, a neon purple
identity, a rose accent held in reserve, uppercase Chakra Petch for controls, Inter for reading
text. Motion is transform/opacity only and collapses to instant on demand.

**The component layer is Nuxt UI v4.** Buttons, inputs, selects, switches, badges, tooltips,
modals, menus, navigation, progress, skeletons, empty states, alerts and toasts all come from it,
themed through a variable bridge onto the tokens below. The hand-rolled CSS primitives that used
to live in `base.css` have been deleted. Wiring, configuration, and the component vocabulary are
in **`sift-nuxt-ui`** — read it before building UI.

---

## Design Tokens

All tokens live in `src/renderer/src/styles/tokens.css` on `:root`. **Never repeat a raw hex
value in a component.** Consume the variable.

### Surfaces — a five-step elevation ramp

| Token     | Value     | Use                                                      |
| --------- | --------- | -------------------------------------------------------- |
| `--bg-0`  | `#0a0a18` | Deepest well: title bar, sidebar, video letterbox, badges |
| `--bg-1`  | `#0f0f23` | Page/app foundation, `body`                              |
| `--bg-2`  | `#15152a` | Toolbars, inset panels, activity blocks                  |
| `--bg-3`  | `#1e1c35` | Cards, popovers, dialogs                                 |
| `--bg-4`  | `#27273b` | Raised control faces                                     |

Each step is a touch lighter and bluer than the last. Elevation is expressed by **moving up the
ramp**, not by adding opacity layers or glass blur.

The app shell in `App.vue` adds two static radial washes over `--bg-1` — purple from the top
right, a fainter rose from the bottom left. That gradient is owned by `App.vue` alone. Do not
repeat radial gradient strings in feature components.

### Text

| Token          | Value     | Use                                             |
| -------------- | --------- | ----------------------------------------------- |
| `--fg`         | `#e2e8f0` | Body and primary text                           |
| `--fg-muted`   | `#94a3b8` | Secondary text, metadata, inactive control text |
| `--fg-dim`     | `#64748b` | Tertiary text, section labels, hint text        |
| `--fg-inverse` | `#0f172a` | Text on a light/solid fill                      |

`--fg-dim` on `--bg-1` is the contrast floor. Do not go dimmer, and do not use `--fg-dim` for
anything a user has to read to complete a task.

### Brand and status

| Token                | Value                   | Use                                                 |
| -------------------- | ----------------------- | --------------------------------------------------- |
| `--primary`          | `#7c3aed`               | Identity, primary action, selection (violet-600)     |
| `--primary-hover`    | `#8b5cf6`               | Hover step (violet-500)                              |
| `--primary-soft`     | `rgba(124,58,237,0.16)` | Quiet selected/active surfaces                       |
| `--secondary`        | `#a78bfa`               | Active icon colour, links, sub-nav (violet-400)      |
| `--accent`           | `#f43f5e`               | Reserved rose — sparingly, never a default CTA fill  |
| `--success`          | `#34d399`               | Success toasts, completed scans                      |
| `--warning`          | `#fbbf24`               | Warnings, unavailable folders                        |
| `--destructive`      | `#ef4444`               | Destructive intent in hand-built chrome              |

**Purple is the action colour; rose is punctuation.** MASTER.md nominates `#F43F5E` as the
primary button fill — the implementation deliberately does not follow it (see Deviations).

⚠️ **`--destructive` vs Nuxt UI `error`.** Nuxt UI's `error` alias is mapped to **rose**, so
`<UButton color="error">` renders rose while `var(--destructive)` is red-500. Use `color="error"`
for anything Nuxt UI renders; reserve the token for scoped CSS on non-Nuxt-UI chrome (currently
just the title-bar close hover). See `sift-nuxt-ui`.

### Borders, rings, shadows

| Token               | Value                    | Use                                            |
| ------------------- | ------------------------ | ---------------------------------------------- |
| `--border`          | `rgba(255,255,255,0.07)` | Default hairline between surfaces              |
| `--border-hover`    | `rgba(255,255,255,0.13)` | Hover/interactive border                       |
| `--border-active`   | `rgba(167,139,250,0.45)` | Selected card                                  |
| `--ring`            | `#a78bfa`                | `:focus-visible` outline                       |
| `--glow-primary`    | ring + purple drop       | Hover/selected emphasis on clip and game cards |
| `--shadow-sm/md/lg` | dark drop shadows        | Cards / popovers / modals                      |

Borders are **white at low alpha**, not a coloured line. They read as an edge on every step of
the surface ramp, which a fixed hex cannot.

### Typography

| Token            | Stack                                        | Use                                          |
| ---------------- | -------------------------------------------- | -------------------------------------------- |
| `--font-display` | `Russo One`, Chakra Petch, system-ui         | Wordmark and hero titles only                |
| `--font-heading` | `Chakra Petch`, Inter Variable, system-ui    | `h1`–`h4`, buttons, section labels, badges   |
| `--font-body`    | `Inter Variable`, Segoe UI, system-ui        | All reading text, inputs, descriptions       |
| `--font-mono`    | Cascadia Code, Consolas, ui-monospace        | Durations, sizes, timecodes (via `.mono`)    |

The same three families are also declared as Tailwind theme fonts in `styles/tailwind.css`
(`--font-sans`, `--font-heading`, `--font-display`), which is what makes `font-heading` usable
as a utility inside a Nuxt UI `:ui` override. **Change one, change both.**

Fonts are self-hosted through `@fontsource*` and imported once in `src/renderer/src/main.ts`.
**Never add a Google Fonts `@import` or `<link>`** — the app must render offline, and the CSP in
`index.html` (`font-src 'self' data:`) blocks it anyway.

`.mono` also sets `font-variant-numeric: tabular-nums`. Use it for any number that updates in
place (clip counts, timecodes, sizes) so the layout does not jitter.

**Scale** — `--text-xs` 12px · `--text-sm` 13.5px · `--text-base` 14px · `--text-md` 15px ·
`--text-lg` 18px · `--text-xl` 22px · `--text-2xl` 28px.

Desktop density: 14px base, not 16px. Do not use the browser-default 16px rhythm here, and do
not go below `--text-xs` for anything.

### Radius, spacing, layout

- App radius: `--r-sm` 6 · `--r-md` 10 · `--r-lg` 14 · `--r-xl` 20 · `--r-full` 999px.
- Nuxt UI radius derives from `--ui-radius: 0.5rem` → `sm` 8 · `md` 12 · `lg` 16. Nuxt UI
  surfaces therefore sit a step rounder than hand-built ones. Accepted; do not chase parity by
  overriding radius per component.
- Spacing: `--s-1` 4 through `--s-12` 48. Use the scale — no arbitrary `13px` gaps.
- Layout: `--titlebar-h` 40px, `--sidebar-w` 60px (icon-only rail), `--page-max` 960px. Read these rather than
  hardcoding.

### Motion variables

- Easing: `--ease-out` (default), `--ease-in-out`, `--ease-spring` (toggles and pops only).
- Duration: `--dur-fast` 140ms · `--dur` 220ms · `--dur-slow` 380ms.
- `html.no-motion` zeroes all three and force-collapses every transition and animation —
  including Nuxt UI's and Reka UI's. Any new animation **must** be expressed through these
  variables, or it will ignore the user's Animations setting. See `sift-motion`.

---

## Deviations from MASTER.md

These are intentional. Keep them.

| MASTER.md says                             | Implementation does                                   | Why                                                                                 |
| ------------------------------------------ | ----------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Body font: Chakra Petch                    | Body is Inter; Chakra Petch is heading/controls only   | Chakra Petch is a display face; unreadable for dense metadata and file names.        |
| Primary button fill `#F43F5E` (rose)       | Primary is violet; rose is reserved                    | Rose reads as destructive next to a Delete action. Purple carries identity.          |
| Border `#4C1D95`                           | White at 7–13% alpha                                   | One border value has to work across a five-step surface ramp.                        |
| Radius 8px / 12px                          | 10/14px app, 8/12/16px Nuxt UI                         | Matches the tighter desktop control heights.                                         |
| Light shadows (`rgba(0,0,0,0.05–0.15)`)    | Deep shadows up to `0 24px 60px -12px rgba(0,0,0,0.7)` | Light-mode shadow values are invisible on a `#0f0f23` ground.                        |
| Modal `background: white`                  | `--bg-3` via `UModal`                                  | Dark-only app.                                                                      |
| "Light mode: text contrast" checklist item | Not applicable                                         | There is no light mode.                                                             |
| Style: 3D & hyperrealism, parallax, WebGL  | Restrained; WebGL (Aurora) lazy-loaded, empty state only | A clip library is a working tool. Ambient 3D fights the thumbnails and burns GPU while a game runs. |
| Anti-pattern: "minimalist design"          | Chrome is quiet; the clips carry the colour            | The thumbnails are the content. Decorated chrome competes with them.                |
| Page pattern: hero > feature grid > social proof > CTA | Content screens fill the width; text-led screens centre one `--page-max` column | Landing-page section order means nothing in a desktop tool. See "Page width".        |

---

## Component Patterns

### Where a component comes from

Decide in this order:

1. **A Nuxt UI component** — every control, overlay, and feedback surface. Check the adoption
   map in `sift-nuxt-ui` first; ~20 types are already in use.
2. **A helper class in `base.css`** — only `.spin`, `.truncate`, `.mono`, `.sr-only`, plus the
   shared Vue transitions `fade` / `pop` / `view`. That is the entire set.
3. **Scoped CSS in the component** — layout and app chrome: the sidebar, title bar, view
   headers, card internals, grid geometry.

`base.css` is now resets + those four helpers + transitions (184 lines). **Do not add a control
primitive to it.** If a Nuxt UI component needs a global style rule, it goes in the `ui` block
of the Vite plugin config, not into CSS.

### Styling a Nuxt UI component

Three mechanisms, in order: the plugin's `ui` block (all instances) → the `:ui` prop
(slot-keyed Tailwind classes, one usage) → a scoped `class` (layout, or when you need a token).
Full detail and examples in `sift-nuxt-ui`.

Stay inside the vocabulary already in use — `color`: `neutral` / `primary` / `error` / `warning`;
`variant`: `ghost` / `subtle` / `soft` / `pill` / `link`. `solid` is not used anywhere.

### Buttons

- All buttons are `UButton`. The house style is set globally in the plugin config
  (`button.slots.base`): Chakra Petch, semibold, uppercase, wide tracking, `cursor-pointer`.
  Buttons look like Sift without per-instance classes — do not re-apply that styling.
- Toolbar and overlay icon buttons: `variant="ghost"`, `square`, a size, and **always** an
  `aria-label`.
- Giving a `UButton` a hand-set `width`/`height` in scoped CSS (window controls, the player's
  round transport buttons) **also needs `justify-content: center`**: Nuxt UI's button base is
  `inline-flex items-center` with no horizontal centring, so the icon otherwise sits at the
  start of the box. Zero the padding at the same time so the box is exactly the size you set.
- Segmented controls are a `UFieldGroup` of `UButton`s, active =
  `color="primary" variant="soft"`, inactive = `color="neutral" variant="subtle"`, each with
  `:aria-pressed`. Colour alone is never the state.
- Destructive actions use `color="error"`.

### Cards

Clip and game cards are the product, and they are **hand-built** (not `UCard`) because the grid
owns their geometry:

- Card body `--bg-3`, `--r-lg`, `--border` hairline, `--shadow-md`.
- The thumbnail is the hero: 16:9, `object-fit: cover`, `--bg-0` behind it while loading, with a
  `USkeleton` placeholder while `probeState === 'pending'`.
- Metadata strip below the media is `--text-sm`, title `--fg` and truncated with `.truncate`,
  secondary line `--fg-muted`, numbers in `.mono`. Overlay chips (resolution, duration) are
  `UBadge`.
- Hover/selected emphasis uses `--border-active` and `--glow-primary`. A `translateY(-2px)` lift
  is allowed. **Never `scale()` a card** — it resamples the thumbnail and shifts neighbours.
- Every card is a real `<button>` or has `tabindex="0"` plus key handling. `cursor: pointer` on
  anything clickable is mandatory (`body` sets `cursor: default`).

`UCard` is used for settings groups, where there is no custom geometry to preserve.

### Page width

Two kinds of screen, and a screen is one or the other — never a capped column pinned to the
left, which is what strands content on a wide monitor:

- **Content screens fill the window.** The clip grid and the games list run edge to edge with a
  28px gutter and reflow into more columns as the window grows (`useVirtualGrid` for clips;
  `grid-template-columns: repeat(auto-fill, minmax(min(100%, 470px), 1fr))` for games). A list
  that would be absurd at 3,000px wide becomes a multi-column grid, it does not stay narrow.
- **Text-led screens centre one reading column.** Settings caps at `--page-max` with
  `margin: 0 auto` and the same 28px gutter, so it is centred on a wide monitor and full-bleed
  once the window is narrower than the cap. Long prose never exceeds a comfortable measure.

### Settings panels

A settings section is one `UCard` — a titled header, then hairline-separated rows:

- Header via the `#header` slot: an `h2` (`--text-md`, 600 — the `h2` inherits Chakra Petch) plus
  one `--text-sm` `--fg-muted` line saying what the section governs. Do not use a floating
  uppercase micro-label above the card; the title belongs inside it.
- Body gets `:ui="{ body: 'p-0 sm:p-0' }"` so the rows own their padding. Each row is
  `var(--s-4) var(--s-6)` — the horizontal value matches the card header's `sm:px-6`, which is
  what makes labels line up down the panel. `.row + .row` carries a `--border` hairline; the
  header/body divider is the card's own.
- Row shape: 36px `--r-md` icon tile on `--bg-3`, then title + description, then the control
  hard right (`USwitch`, `USelect`, or an icon-button cluster). The text block takes the slack
  (`flex: 1; min-width: 0`) so the control never drifts inward.
- A destructive icon button sits a step away from the control beside it.

### Grid

The clip grid is windowed by `useVirtualGrid`. Layout constants (`GRID_PAD_X`, gap, card
minimums per `GridSize`) live in that composable, and rows are absolutely positioned with
`transform: translateY(...)` and `will-change: transform`. **Change sizing there, not in CSS** —
a CSS gap change the composable does not know about will misplace every row. Each card is
wrapped in a `UContextMenu`. See `sift-engineering`.

### Overlays and feedback

- **Dialogs** — `DialogHost.vue` renders one `UModal` driven by the `useDialogs` promise
  queue, with `UFormField` + `UInput` for prompts. Focus trapping, `Esc`, and focus restoration
  come from Nuxt UI. Never use native `window.confirm` / `window.prompt`.
- **Context menu** — `UContextMenu` with a two-group item array; the destructive entry carries
  `color: 'error'`. There is no hand-rolled menu any more.
- **Toasts** — raised by `toast(kind, title, message?)` from `useToasts`, forwarded to the Nuxt
  UI toaster by `ToastBridge.vue`. Position and duration are configured once on `<UApp>`. Kind is
  carried by an icon **and** a colour. Never call `useToast()` outside the bridge, and never
  build one-off notification UI.
- **Player** — `PlayerOverlay.vue`, full-bleed `--bg-0`, chrome fades on idle. Transport controls
  are `UButton` inside `UTooltip` with `:kbds` showing the shortcut. Every key in the README's
  table must keep working, and controls must stay reachable by keyboard while chrome is hidden.
- **Title bar** — `UBreadcrumb` trail, `UBadge` scan status, `UButton` window controls. See §8 of
  `sift-electron-vue` for the drag-region rules.

### Empty, loading, and error states

Every async surface needs all three, and they must be distinguishable:

- **Loading** — `USkeleton` sized to the final layout so nothing shifts; `UProgress` for
  indeterminate background activity (the sidebar scan block). For an in-place action use a
  disabled button with a progress label. Do not replace already-rendered content with skeletons
  during a background rescan.
- **Empty** — `UEmpty` with `icon`, `title`, `description`, and `:actions` for the inline call to
  action. Say what is missing *and* what to do about it. The no-folders hero is the one screen
  allowed the decorative treatment (Aurora, Folder, StarBorder).
- **Error** — a folder that is `available: false` (`UAlert`), a clip with
  `probeState: 'failed'`, a failed rename (error toast). Show the reason and the recovery. A
  skeleton must never hide a terminal error.

---

## Tailwind Utilities

Tailwind v4 is imported in full (**including preflight**) by `styles/tailwind.css`, which is why
`base.css` no longer resets buttons beyond `cursor`. App CSS is unlayered and always wins over a
utility class.

Where utilities are allowed:

- ✅ Inside a Nuxt UI `:ui` block, and in `class` on a Nuxt UI component (`w-44`, `size-4`,
  `animate-spin`, `text-dimmed`, `font-heading`). This is how Nuxt UI is meant to be tuned.
- ✅ Inside `components/bits/` — the Vue Bits copies keep their upstream utility classes.
- ❌ For app chrome layout — the sidebar, title bar, view headers, card internals, grid geometry.
  That stays in `<style scoped>` against the tokens.
- ❌ `@apply`. Never.

The line: *tuning a Nuxt UI component → utilities; laying out the app → scoped CSS and tokens.*

---

## Interactions and Animations

- **Transitions:** `--dur-fast` for hover/focus/press, `--dur` for surfaces and state,
  `--dur-slow` for view changes. Always via the variables so `no-motion` can zero them.
- **Easing:** `--ease-out` by default; `--ease-spring` only for toggles and pop-ins.
- **Hover:** colour, border, shadow, opacity. `translateY(-2px)` at most on a card.
- **Focus:** `:focus-visible` paints a 2px `--ring` outline with a 2px offset. `base.css` removes
  the plain `:focus` outline — **never** remove `:focus-visible` too.
- **Never** animate `width`, `height`, `top`, `left`, `padding`, `margin`, or `filter` on grid
  rows, cards, or anything repeated. Transform and opacity only.

Full motion rules, the Vue Bits inventory, and the adoption workflow are in `sift-motion`.

---

## Accessibility

- All interactive elements keyboard operable, with a visible `:focus-visible` ring.
- Icon-only controls need an `aria-label`. Nuxt UI does not invent one from the icon name, and
  `Icon.vue` renders `aria-hidden="true"` on its SVG, so the label always lives on the control.
- Segmented `UFieldGroup` buttons carry `:aria-pressed`; `USwitch` carries `aria-label`.
- Contrast: 4.5:1 for text, 3:1 for meaningful boundaries and large text, measured against the
  actual surface token behind the element.
- State is never colour alone — pair it with an icon, a label, or `aria-*`.
- Use semantic elements. `body` sets `user-select: none` and `cursor: default`, so anything
  clickable must be a `<button>`/`<a>` (or carry `role`, `tabindex`, key handlers, and
  `cursor: pointer`), and anything selectable must opt back in with `user-select: text`.
- Overlays get focus trapping, `Esc` to close, focus restoration, and `inert` on the background —
  `App.vue` sets `:inert="isOpen"` on the body while the player is up.
- Respect `prefers-reduced-motion` — already wired through `useMotion` into `html.no-motion`.
- The frameless title bar uses `-webkit-app-region: drag`. Every control inside it must set
  `-webkit-app-region: no-drag`, or it becomes unclickable.

---

## Anti-Patterns (Do NOT Use)

- ❌ Raw hex values in components — consume the tokens
- ❌ Reintroducing a deleted CSS primitive (`.btn`, `.input`, `.segmented`, `.toggle`, `.pill`, `.icon-btn`)
- ❌ A light theme, `dark:` variants, or `prefers-color-scheme` branches
- ❌ `--ui-*` variable names anywhere but `tokens.css`
- ❌ Remote font or asset requests (Google Fonts `@import`, CDN images) — the CSP blocks them
- ❌ Emoji as icons — use `i-lucide-*` in Nuxt UI props, `Icon.vue` in hand-built markup
- ❌ Missing `cursor: pointer` on a clickable element
- ❌ `scale()` on cards, rows, or any layout surface
- ❌ Layout-shifting hover states
- ❌ Instant state changes (no transition) or slow ones (>400ms)
- ❌ Invisible or removed focus states
- ❌ Glass/backdrop-blur surfaces beyond card badges and the modal scrim
- ❌ Ambient/looping background animation on a working screen
- ❌ Hardcoding `40px` / `60px` / `960px` instead of `--titlebar-h` / `--sidebar-w` / `--page-max`
- ❌ A max-width column left-pinned in a full-width screen — fill the width or centre the column
- ❌ Grid sizing in CSS that `useVirtualGrid` does not know about
- ❌ Tailwind utilities for app chrome layout, or `@apply` anywhere
- ❌ One-off toast, dialog, or menu implementations beside the shared hosts

---

## Pre-Delivery Checklist

When creating or changing a renderer surface:

- [ ] Checked the Nuxt UI adoption map before hand-building a control
- [ ] Every colour, radius, space, duration and easing comes from a token
- [ ] Stayed inside the `color` / `variant` vocabulary already in use
- [ ] Correct font role: Chakra Petch for headings/controls, Inter for reading text, `.mono` for numbers
- [ ] `cursor: pointer` and a hover state on everything clickable
- [ ] `:focus-visible` ring intact and visible on every interactive element
- [ ] Icon-only controls have an `aria-label`; toggles carry `aria-pressed` / `aria-checked`
- [ ] Text meets 4.5:1 against its actual surface token
- [ ] State conveyed by more than colour
- [ ] Loading, empty, and error states all present and distinguishable
- [ ] Skeletons match the final layout — no shift on load
- [ ] Only transform/opacity animated, timed with `--dur*`, verified with Animations off
- [ ] No new raw hex, no light-mode code, no remote asset request
- [ ] Utilities only on Nuxt UI components / in `bits/`; app chrome in scoped CSS
- [ ] Grid/layout constants changed in `useVirtualGrid`, not only in CSS
- [ ] Controls inside the title bar set `-webkit-app-region: no-drag`
- [ ] Screen either fills the width or centres a `--page-max` column — never capped and left-pinned
- [ ] Verified at a narrow window (~980px, the enforced minimum) and maximised — no clipping, no horizontal scroll
- [ ] `npm run typecheck` passes

---

## Design Specifications Summary

- **Color mode:** Dark only (`<html class="dark">`, `colorMode: false`); eleven dark themes via `html[data-theme]`
- **Foundation:** Five-step indigo-black surface ramp (`--bg-0` … `--bg-4`)
- **Identity:** `#7c3aed` violet; `#f43f5e` rose held in reserve
- **Display / heading / body:** Russo One · Chakra Petch · Inter Variable
- **Base size:** 14px (desktop density)
- **Radius:** 10/14px app chrome, 8/12/16px Nuxt UI
- **Spacing scale:** 4, 8, 12, 16, 20, 24, 32, 40, 48px
- **Shadow intensity:** Deep — authored for a `#0f0f23` ground
- **Component kit:** Nuxt UI v4, themed through the `--ui-*` bridge in `tokens.css`
