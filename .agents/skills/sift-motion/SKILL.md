---
name: sift-motion
description: Use for Sift animation and motion work, including Vue Bits adoption, GSAP and motion-v usage, view transitions, grid and card entry motion, hover motion, the Animations setting and reduced-motion behavior, accessibility, and animation performance.
---

<!-- Project-scoped instruction asset. Keep this file scoped to the Sift renderer. -->

# Sift Motion Rules

## Motion Direction

Sift is a gaming-adjacent app, so it earns more motion than a business tool — but it is
still a **working tool that runs while a game is running**. Motion must make state, hierarchy,
and cause-and-effect easier to read, and it must never cost the user frames.

The intended character:

- confident, springy entrances for content the user just asked for;
- FLIP continuity when a clip becomes the player and back again;
- short, quiet transitions for hover, focus, and press;
- decorative motion **concentrated on the empty state**, where there is no work to do;
- nothing ambient, looping, or GPU-hungry on a screen full of thumbnails.

Use the smallest mechanism that solves the problem.

---

## The Motion Gate — non-negotiable

Every animation in the app is gated by `motionEnabled` from
`src/renderer/src/composables/useMotion.ts`:

```ts
export const motionEnabled = computed(() => settings.value.animations && !osReduced.value)
```

It is true only when **both** the user's Animations setting is on **and** the OS is not asking
for reduced motion. A `watchEffect` mirrors it onto `<html class="no-motion">`, and `tokens.css`
zeroes `--dur-fast`, `--dur`, `--dur-slow` and force-collapses every transition and animation
under that class.

Consequences you must respect:

1. **CSS motion must be timed with `--dur*` and `--ease-*`.** A hardcoded `transition: 200ms`
   silently ignores the user's setting.
2. **JS motion must check `motionEnabled` first** and jump to the final state when it is false —
   as `staggerIn`, `flipFrom`, `flipTo`, and `fadeOut` already do.
3. **WebGL and canvas effects must unmount or no-op**, not merely freeze.
4. Reduced motion must render the same information, the same final state, the same focus
   target, and the same reading order.

Because the `no-motion` rule uses a universal selector with `!important`, it also collapses
motion the app did not author — **Nuxt UI's transitions and Reka UI's data-state keyframes are
covered**, verified in the running app. That is why no per-component reduced-motion wiring is
needed for `UModal`, `UContextMenu`, `UTooltip`, or the toaster.

Never bypass the gate with an inline `style="animation:…"` or a third-party component's own
internal defaults.

---

## Ownership Order

Reach for motion sources in this order. Do not skip a level because a lower one is more fun.

1. **CSS transitions with the tokens** — `--dur-fast` / `--dur` / `--dur-slow` and
   `--ease-out` / `--ease-in-out` / `--ease-spring`. This covers hover, focus, press, colour,
   border, shadow, and opacity. Most motion in the app is here.
2. **The shared Vue transition classes in `base.css`** — `fade`, `pop`, `view`. Reuse them on
   `<Transition>`; do not author new `*-enter-active` rules for the same job.
3. **`useMotion.ts` helpers** — `staggerIn` (grid/card entry), `flipFrom` / `flipTo` (the
   card ⇄ player zoom), `fadeOut`. Add a new preset here when a pattern recurs; do not scatter
   similar GSAP tweens through components.
4. **An existing Vue Bits copy in `components/bits/`** — twelve are already adopted and themed.
5. **A new Vue Bits component**, copied in and adapted via the workflow below — only when it
   solves a real problem the levels above cannot.

**Do not add a fourth animation runtime.** The app ships exactly three:

| Runtime    | Owns                                                        |
| ---------- | ----------------------------------------------------------- |
| `gsap`     | Timeline work: stagger, FLIP, SplitText, ScrollTrigger      |
| `motion-v` | Declarative Vue-idiomatic transitions inside Vue Bits copies |
| `ogl`      | WebGL — **Aurora only**, empty state only, lazy-loaded      |

No Framer Motion for Vue clones, no anime.js, no Lottie, no `tailwindcss-animate`.

Nuxt UI brings its own CSS transitions and Reka UI data-state keyframes for overlays, toasts,
tooltips and menus. That is a fourth *source* but not a fourth runtime, and it is already
covered by the motion gate — see below. Do not layer `motion-v` on top of a Nuxt UI component;
it already has a transition.

---

## Timing and Easing

| Motion role                                  | Duration                | Token / value                     |
| -------------------------------------------- | ----------------------- | --------------------------------- |
| Hover, focus, press, icon response           | 140ms                   | `--dur-fast`, `--ease-out`        |
| Standard surface / state transition          | 220ms                   | `--dur`, `--ease-out`             |
| Modal, context menu, tooltip, toast          | Nuxt UI defaults        | owned by Nuxt UI / Reka UI        |
| App-authored pop-in (sidebar activity block) | 220ms in / 140ms out    | `pop` classes in `base.css`       |
| View switch (library ⇄ folders)              | 380ms in / 140ms out    | `view` classes in `base.css`      |
| Card / grid entry stagger                    | 420ms, `back.out(1.4)`  | `staggerIn`                       |
| FLIP zoom into the player                    | 460ms, `power3.out`     | `flipFrom`                        |
| FLIP zoom back to the grid                   | 300ms, `power2.in`      | `flipTo`                          |
| Toggle knob                                  | 220ms, `--ease-spring`  | `.toggle` in `base.css`           |

- `--ease-out` is the default. Reserve `--ease-spring` for toggles and pop-ins.
- The `back.out(1.4)` overshoot in `staggerIn` is the MASTER.md "Stagger List" preset and is
  correct for a card grid. **Do not use it on dense text rows or list items** — the overshoot
  reads as sloppy on informational UI.
- Stagger increment is `0.028s` per item with `grid: 'auto'`. Keep it small: on a windowed grid
  a large increment means the last visible card animates after the user has already scrolled.
- Exits are always faster than entrances.
- **Never delay the user's requested action so an animation can finish.** The player opens
  immediately; the FLIP runs over it.

---

## Vue Bits

Vue Bits components are **copied into the repository**, not imported from a package (the jsrepo
model). Each file in `src/renderer/src/components/bits/` is editable app code that we own and
maintain, and each carries a header naming its upstream URL and every local adaptation:

```
/**
 * Vue Bits — TextAnimations/CountUp (https://vue-bits.dev/text-animations/count-up)
 * Adapted: when `to` changes after the first run (a live library count going
 * 36 → 37) the number springs from its current value instead of resetting to
 * `from` and freezing, which is what the upstream watcher did.
 */
```

**Keep that header accurate when you edit one.** It is the only record of why our copy differs
from upstream.

### Current inventory and approved use

| Component                    | Approved use                | Notes                                                          |
| ---------------------------- | --------------------------- | -------------------------------------------------------------- |
| `SplitText`                  | Screen titles               | GSAP SplitText; `immediate` skips ScrollTrigger (titles never scroll) |
| `CountUp`                    | Header stats                | Patched to re-animate from the current value on live change     |
| `ShinyText`                  | Wordmark only               | motion-v. Never on body text or buttons                         |
| `BlurText`                   | Empty-state heading         | motion-v, `tag` prop                                            |
| `AnimatedList` + `SpotlightCard` | Games browser           | Generic slot list with ↑/↓/Enter; upstream Tab hijack removed   |
| `ElasticSlider`              | Player volume               | `v-model` added                                                 |
| `Folder`, `StarBorder`       | Empty state only            | Decorative                                                      |
| `Aurora` (ogl)               | Empty state only            | WebGL — lazy-loaded via `defineAsyncComponent`, so `ogl` never enters the main chunk |
| `Magnet`                     | Add-folder button           | The one magnetic control in the app                             |
| `ClickSpark`                 | Whole window                | Draw loop runs only while sparks exist                          |

Every one of them renders static or unmounts when `motionEnabled` is false. A new copy must do
the same before it ships.

### Adoption workflow for a new Vue Bits component

1. State the user problem and why levels 1–4 of the ownership order cannot solve it.
2. Check the current component source and props on <https://vue-bits.dev> before copying —
   do not paste from memory or a third-party example.
3. Copy the single component file into `src/renderer/src/components/bits/`. Copy only what you
   use; do not import the gallery.
4. Read every line of it. Upstream demos assume Tailwind utilities, React-ish prop shapes, and
   light backgrounds — none of which hold here.
5. Add the provenance header: source URL plus each adaptation and its reason.
6. Replace demo colours, radii, shadows, fonts, and timings with Sift tokens and the
   timing table above.
7. Wire the motion gate: a `disabled`/`animated` prop driven by `motionEnabled`, or a `v-if`
   that unmounts it. Verify the static fallback renders the same content.
8. Tear down everything on unmount — GSAP tweens (`gsap.killTweensOf`), ScrollTriggers,
   `requestAnimationFrame` loops, `ResizeObserver`s, WebGL contexts, and listeners.
9. Confirm keyboard behaviour is unchanged or better. `AnimatedList` needed its Tab hijack
   removed for exactly this reason.
10. Check the renderer bundle before and after. Reject the component if the cost is not paid
    back by the UX improvement.

Tailwind v4 (supplied by the Nuxt UI plugin) is imported in full by `styles/tailwind.css`, so
these copies keep their upstream utility classes as-is. The app's own CSS is **unlayered** and
therefore always wins over a utility, which is what keeps the design system enforceable.
Utilities stay confined to `bits/` and to Nuxt UI `:ui` / `class` overrides — app chrome is
authored in scoped CSS against the tokens.

---

## Approved Motion Patterns

### Grid and card entry

- Use `staggerIn(elements)` for cards entering a screen. It kills existing tweens, animates
  opacity/`y`/`scale` only, and clears props on completion so nothing is left transformed.
- The grid is **windowed**. Only animate rows as they first mount; do not replay entry motion
  for rows that scroll back into view, and do not animate during a background rescan while
  stable content is on screen.
- Never animate a row's height, or the grid's layout, on scroll.

### Card ⇄ player continuity

- `flipFrom(el, rect)` on open and `flipTo(el, rect, done)` on close give the clip a continuous
  identity between the grid and the player. Both animate transform/opacity from a measured
  `getBoundingClientRect()`, and both fall through to the final state instantly when motion is off.
- Measure **once**, before the DOM changes. Do not interleave layout reads with tween writes.

### View and overlay transitions

- View switches use the `view` classes on a `<Transition mode="out-in">`; the player and the
  ready-state body use `fade`; the sidebar activity block uses `pop`.
- The player mounts under `<Transition name="fade">` and marks the body `inert` while open.
  Any new full-screen overlay must do the same.
- **Modals, context menus, tooltips and toasts no longer have app-authored motion** — they come
  from Nuxt UI (`UModal`, `UContextMenu`, `UTooltip`, the `UApp` toaster). Tune them through the
  `:ui` prop or the plugin's `ui` block if a default feels slower than the app's 220ms, and
  leave the enter/exit mechanics alone. Do not wrap them in a `<Transition>`.

### Hover, focus, press

- Colour, border, shadow, opacity. `translateY(-2px)` at most on a genuinely interactive card.
- Button hover/press feedback belongs to Nuxt UI's `UButton` — do not re-add a press transform
  on top of it, and do not reintroduce the deleted `.btn` / `.icon-btn` primitives to get one.
- **Never `scale()` a card, a grid row, or a layout surface.** It resamples the thumbnail and
  shifts its neighbours.

### Changing numbers

- `CountUp` is approved for header stats that change while the user watches (clip counts during
  a scan). Keep one stable accessible value; do not animate every number on first paint, and
  never leave a duration or size ambiguous while it counts.

### Decoration

- `Aurora`, `Folder`, `StarBorder`, `BlurText`, `ShinyText` belong to the **empty state and the
  wordmark**. That is the whole allowance. They do not migrate onto the games browser, the grid,
  or the player.

---

## Prohibited Motion

- ❌ Ambient or looping background animation on any working screen (grid, games, folders, player)
- ❌ WebGL outside the empty-state `Aurora`
- ❌ Cursor-following, parallax, scroll-jacking, or auto-scrolling on content screens
- ❌ Marquees, tickers, typewriter text, or repeated text reveals
- ❌ Infinite icon loops, decorative pulsing, bouncing CTAs, repeated count-ups
- ❌ 3D tilt, large rotation, zoom transitions, or perspective scenes on cards
- ❌ Large animated blur or `filter` regions (backdrop blur is limited to `.badge` and the dialog scrim)
- ❌ Animating `width`, `height`, `top`, `left`, `padding`, `margin`, `box-shadow` blur, or grid
  tracks on repeated or large elements
- ❌ Animation inside `useVirtualGrid`'s measurement path
- ❌ Replaying entry motion during a background rescan while content is already on screen
- ❌ Motion that makes a duration, file size, or destructive-action target temporarily ambiguous
- ❌ A hardcoded duration or easing that bypasses the tokens

Spinners may rotate only while an operation is genuinely pending, and must stop when it settles.
Use `.spin` from `base.css` in hand-built markup and Tailwind's `animate-spin` inside a Nuxt UI
`:ui` override (as the title-bar scan badge does). Both collapse under `html.no-motion`.

---

## Performance Rules

This app animates on the same GPU that is rendering a game. Treat every effect as a cost.

- Transform and opacity only. They stay on the compositor; layout properties do not.
- Mount expensive effects **conditionally, not permanently**, and load them lazily when the
  dependency is heavy. `LibraryView` pulls `Aurora` in with
  `defineAsyncComponent(() => import('./bits/Aurora.vue'))`, so `ogl` is fetched only if the
  empty state actually renders; `ClickSpark`'s draw loop runs only while sparks exist. Follow
  both patterns: a `requestAnimationFrame` loop with nothing to draw must stop, not idle.
- One `ResizeObserver` per container, `rAF`-coalesced — as `useVirtualGrid` does. Do not add a
  second observer or a scroll listener that measures on every event.
- No global pointer listeners or continuous springs for ambient effects.
- Do not add `will-change` speculatively; it costs memory per layer.
- `gsap.killTweensOf` before re-animating the same elements, and `clearProps` when the tween is
  done so nothing is left with a stale transform.
- Register GSAP plugins once at module scope (`gsap.registerPlugin(...)`), never per component
  instance.
- Keep animated islands small. Do not animate a container when you mean to animate its children.
- Check the renderer bundle when introducing a component; `ogl` and GSAP plugins are not free.

---

## Accessibility Rules

- The motion gate is the accessibility contract. `prefers-reduced-motion` is honoured through
  `useMotion`, and the user can also switch Animations off explicitly. Both paths must work.
- Reduced motion renders the same information, final state, focus target, and reading order.
- Motion may reinforce a state but can never be its only indicator — pair it with colour, an
  icon, a label, or `aria-*`.
- Never animate focus into a different place, and always restore focus to the trigger when an
  overlay closes.
- Decorative animated elements are `aria-hidden="true"`.
- Avoid motion near text input and inside the player's control strip while the user is scrubbing.
- Announce async state with text (`.sr-only` or a visible label), not with motion alone.
- Animation must not change focus order, hit-target size, or scroll position.

---

## Verification

After any motion change, from the project root:

```bash
npm run typecheck
```

Then verify in the running app (ask the user to reload with `Ctrl+R` — do not drive their
window with synthetic input):

- with Animations **on**, and again with Animations **off** in Settings;
- with the OS reduced-motion preference enabled;
- keyboard operation and focus restoration through any animated overlay;
- a large library: entry stagger while scrolling fast, and a background rescan that must **not**
  replay entry motion;
- the card → player → card FLIP round trip, including closing from a different scroll position;
- no leftover transform or opacity after a tween (inspect an element post-animation);
- no `requestAnimationFrame` loop still running after the effect leaves the screen;
- window resize and maximise mid-animation — no layout shift, no horizontal overflow;
- the app stays responsive with a game running (the real test).
