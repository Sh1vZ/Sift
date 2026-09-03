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
        input: { index: resolve('src/renderer/index.html') }
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
            slots: { base: 'font-heading font-semibold uppercase tracking-wider cursor-pointer' }
          }
        },
        icon: { mode: 'svg', clientBundle: { scan: true, sizeLimitKb: 512 } }
      })
    ]
  }
})
