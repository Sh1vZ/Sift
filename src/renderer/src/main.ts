import { createApp } from 'vue'
import ui from '@nuxt/ui/vue-plugin'
import '@fontsource/russo-one'
import '@fontsource/chakra-petch/500.css'
import '@fontsource/chakra-petch/600.css'
import '@fontsource/chakra-petch/700.css'
import '@fontsource-variable/inter'
import './styles/tailwind.css'
import './styles/tokens.css'
import './styles/base.css'
import App from './App.vue'
import { alertError } from './composables/useDialogs'

// eslint-disable-next-line @typescript-eslint/no-unsafe-argument -- .vue modules are untyped to eslint; vue-tsc type-checks this
const app = createApp(App).use(ui)

/**
 * Nothing in the renderer may fail silently: an exception in a handler or a
 * promise nobody awaited reaches the user as a dialog, with the detail in the
 * console. Without this a broken click looks like a click that did nothing —
 * and unlike the failures Sift expects, this one means whatever was in flight
 * may have stopped halfway, so it is worth being stopped for. `alertError`
 * folds an error that repeats into the one dialog already on screen.
 */
const describe = (err: unknown): string =>
  err instanceof Error ? err.message : typeof err === 'string' ? err : 'Unknown error'
const unexpected = (detail: string): void => {
  void alertError({
    title: 'Something went wrong',
    message:
      'Sift hit an error it does not handle. Whatever you were doing may not have finished — check the result before carrying on, and reload the window with Ctrl+R if it stops responding.',
    detail,
  })
}
app.config.errorHandler = (err, _instance, info) => {
  console.error(`[renderer] ${info}:`, err)
  unexpected(describe(err))
}
window.addEventListener('unhandledrejection', (e) => {
  console.error('[renderer] unhandled rejection:', e.reason)
  unexpected(describe(e.reason))
})

app.mount('#app')
