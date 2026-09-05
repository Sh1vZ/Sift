import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import vue from '@vitejs/plugin-vue'
import ui from '@nuxt/ui/vite'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: { index: resolve('src/main/index.ts') },
      },
    },
    resolve: {
      alias: { '@shared': resolve('src/shared') },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: { index: resolve('src/preload/index.ts') },
      },
    },
    resolve: {
      alias: { '@shared': resolve('src/shared') },
    },
  },
  renderer: {
    root: 'src/renderer',
    resolve: {
      alias: {
        '@': resolve('src/renderer/src'),
        '@shared': resolve('src/shared'),
      },
    },
    build: {
      rollupOptions: {
        // Two entries: the app, and the launch splash shown while it boots.
        input: {
          index: resolve('src/renderer/index.html'),
          splash: resolve('src/renderer/splash.html'),
        },
      },
    },
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
            neutral: 'slate',
          },
          // Desktop density, one size up from Nuxt UI's defaults: `lg` buttons, inputs
          // and selects all come out 40px tall (14–15px text plus 10px of padding), so a
          // toolbar row lines up without a size prop at every call site. The padding
          // overrides merge onto the theme's `py-2` and win through tw-merge. Tailwind
          // never scans this file, so every utility named here is safelisted in
          // styles/tailwind.css — add to that list when adding one here.
          button: {
            slots: { base: 'font-heading font-semibold uppercase tracking-wider cursor-pointer' },
            variants: {
              size: {
                lg: { base: 'py-2.5 px-3.5' },
                xl: { base: 'py-2.5 px-4' },
              },
            },
            defaultVariants: { size: 'lg' },
            compoundVariants: [
              // Nuxt UI paints solid primary buttons with `text-inverted`, which the token
              // bridge maps to the near-black --fg-inverse. Text on the primary colour is
              // --on-primary; `.on-primary` in base.css applies it (app CSS is unlayered, so
              // it beats the utility, and nothing depends on Tailwind scanning this file).
              { color: 'primary', variant: 'solid', class: 'on-primary' },
              // Icon-only buttons keep the height of their labelled neighbours.
              { size: 'lg', square: true, class: 'p-2.5' },
              { size: 'xl', square: true, class: 'p-2.5' },
            ],
          },
          // `xl` fields sit beside `lg` buttons in the toolbars, so they get the same
          // vertical padding and come out the same height.
          input: {
            variants: { size: { lg: { base: 'py-2.5' }, xl: { base: 'py-2.5' } } },
            defaultVariants: { size: 'lg' },
          },
          select: {
            variants: { size: { lg: { base: 'py-2.5' }, xl: { base: 'py-2.5' } } },
            defaultVariants: { size: 'lg' },
          },
          fieldGroup: { defaultVariants: { size: 'lg' } },
          switch: { defaultVariants: { size: 'lg' } },
          badge: { defaultVariants: { size: 'md' } },
          // Two actions ("Copy YouTube link" and "Open on YouTube") are wider
          // together than the 384px toast, and the theme lays them out in a
          // nowrap row, so the second one ran off the edge and was clipped.
          // Wrapping puts it on a second line instead.
          toast: { slots: { actions: 'flex-wrap' } },
          dropdownMenu: { defaultVariants: { size: 'lg' } },
          contextMenu: { defaultVariants: { size: 'lg' } },
        },
        icon: {
          mode: 'svg',
          clientBundle: {
            // The default scan skips .ts, but the settings rail names its icons in a composable.
            scan: { globInclude: ['**/*.{vue,ts,jsx,tsx,md,mdc,mdx,yml,yaml}'] },
            sizeLimitKb: 512,
          },
        },
      }),
    ],
  },
})
