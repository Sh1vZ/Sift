import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import vue from '@vitejs/plugin-vue'
import ui from '@nuxt/ui/vite'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: { index: resolve('src/main/index.ts') }
      }
    },
    resolve: {
      alias: { '@shared': resolve('src/shared') }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: { index: resolve('src/preload/index.ts') }
      }
    },
    resolve: {
      alias: { '@shared': resolve('src/shared') }
    }
  },
  renderer: {
    root: 'src/renderer',
    resolve: {
      alias: {
        '@': resolve('src/renderer/src'),
        '@shared': resolve('src/shared')
      }
    },
    build: {
      rollupOptions: {
        // Two entries: the app, and the launch splash shown while it boots.
        input: {
          index: resolve('src/renderer/index.html'),
          splash: resolve('src/renderer/splash.html')
        }
      }
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
            neutral: 'slate'
          },
          button: {
            slots: { base: 'font-heading font-semibold uppercase tracking-wider cursor-pointer' },
            // Nuxt UI paints solid primary buttons with `text-inverted`, which the token
            // bridge maps to the near-black --fg-inverse. Text on the primary colour is
            // --on-primary; `.on-primary` in base.css applies it (app CSS is unlayered, so
            // it beats the utility, and nothing depends on Tailwind scanning this file).
            compoundVariants: [{ color: 'primary', variant: 'solid', class: 'on-primary' }]
          }
        },
        icon: {
          mode: 'svg',
          clientBundle: {
            // The default scan skips .ts, but the settings rail names its icons in a composable.
            scan: { globInclude: ['**/*.{vue,ts,jsx,tsx,md,mdc,mdx,yml,yaml}'] },
            sizeLimitKb: 512
          }
        }
      })
    ]
  }
})
