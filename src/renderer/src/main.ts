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
import { toast } from './composables/useToasts'

// eslint-disable-next-line @typescript-eslint/no-unsafe-argument -- .vue modules are untyped to eslint; vue-tsc type-checks this
const app = createApp(App).use(ui)

/**
 * Nothing in the renderer may fail silently: an exception in a handler or a
 * promise nobody awaited reaches the user as a toast, with the detail in the
 * console. Without this a broken click looks like a click that did nothing.
 */
const describe = (err: unknown): string =>
  err instanceof Error ? err.message : typeof err === 'string' ? err : 'Unknown error'
app.config.errorHandler = (err, _instance, info) => {
  console.error(`[renderer] ${info}:`, err)
  toast('error', 'Something went wrong', describe(err))
}
window.addEventListener('unhandledrejection', (e) => {
  console.error('[renderer] unhandled rejection:', e.reason)
  toast('error', 'Something went wrong', describe(e.reason))
})

app.mount('#app')
