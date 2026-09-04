<script setup lang="ts">
import { computed } from 'vue'

const props = withDefaults(defineProps<{ name: string; size?: number; stroke?: number }>(), {
  size: 18,
  stroke: 2,
})

/**
 * Thin wrapper over Nuxt UI's <UIcon> keeping the app's short icon names.
 * Values are written as full `i-lucide-*` literals on purpose: the Nuxt UI
 * Vite plugin scans source for that pattern and bundles the SVGs, so the app
 * never fetches icons over the network.
 */
const ICONS: Record<string, string> = {
  play: 'i-lucide-play',
  pause: 'i-lucide-pause',
  'skip-back': 'i-lucide-skip-back',
  'skip-forward': 'i-lucide-skip-forward',
  volume: 'i-lucide-volume-2',
  'volume-low': 'i-lucide-volume-1',
  'volume-x': 'i-lucide-volume-x',
  expand: 'i-lucide-maximize',
  shrink: 'i-lucide-minimize',
  x: 'i-lucide-x',
  'chevron-down': 'i-lucide-chevron-down',
  'chevron-left': 'i-lucide-chevron-left',
  'chevron-right': 'i-lucide-chevron-right',
  refresh: 'i-lucide-refresh-cw',
  trash: 'i-lucide-trash-2',
  pencil: 'i-lucide-pencil',
  'folder-open': 'i-lucide-folder-open',
  folder: 'i-lucide-folder',
  'folder-plus': 'i-lucide-folder-plus',
  sliders: 'i-lucide-sliders-horizontal',
  grid: 'i-lucide-layout-grid',
  'grid-lg': 'i-lucide-grid-2x2',
  'grid-sm': 'i-lucide-grid-3x3',
  gamepad: 'i-lucide-gamepad-2',
  clock: 'i-lucide-clock',
  film: 'i-lucide-film',
  check: 'i-lucide-check',
  alert: 'i-lucide-triangle-alert',
  info: 'i-lucide-info',
  calendar: 'i-lucide-calendar',
  sort: 'i-lucide-arrow-up-down',
  loader: 'i-lucide-loader-circle',
  more: 'i-lucide-ellipsis',
  repeat: 'i-lucide-repeat',
  gauge: 'i-lucide-gauge',
  replay: 'i-lucide-rotate-ccw',
  minus: 'i-lucide-minus',
  square: 'i-lucide-square',
  restore: 'i-lucide-copy',
  'hard-drive': 'i-lucide-hard-drive',
  eye: 'i-lucide-eye',
  image: 'i-lucide-image',
  sparkles: 'i-lucide-sparkles',
  cpu: 'i-lucide-cpu',
  'list-video': 'i-lucide-list-video',
  radar: 'i-lucide-radar',
  'video-off': 'i-lucide-video-off',
  search: 'i-lucide-search',
  database: 'i-lucide-database',
  activity: 'i-lucide-activity',
  timer: 'i-lucide-timer',
  box: 'i-lucide-box',
  package: 'i-lucide-package',
  zap: 'i-lucide-zap',
  memory: 'i-lucide-memory-stick',
  trending: 'i-lucide-trending-up',
  scissors: 'i-lucide-scissors',
  'folder-output': 'i-lucide-folder-output',
  download: 'i-lucide-download',
  link: 'i-lucide-link',
  tray: 'i-lucide-panel-bottom',
  youtube: 'i-lucide-youtube',
  'cloud-upload': 'i-lucide-cloud-upload',
  upload: 'i-lucide-upload',
  key: 'i-lucide-key-round',
  'external-link': 'i-lucide-external-link',
  'shield-check': 'i-lucide-shield-check',
  'list-music': 'i-lucide-list-music',
  'file-json': 'i-lucide-file-json',
  lock: 'i-lucide-lock',
}

const icon = computed(() => ICONS[props.name] ?? `i-lucide-${props.name}`)
</script>

<template>
  <UIcon :name="icon" class="icon" :style="{ width: `${size}px`, height: `${size}px` }" />
</template>

<style scoped>
.icon {
  flex: 0 0 auto;
  display: block;
}
</style>
