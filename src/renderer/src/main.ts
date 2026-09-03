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

createApp(App).use(ui).mount('#app')
