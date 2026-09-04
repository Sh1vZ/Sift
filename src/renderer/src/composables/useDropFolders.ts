import { onBeforeUnmount, ref, watch, type Ref } from 'vue'
import { addDroppedFolders } from './useLibrary'

/**
 * Once per app, from App.vue: a drop that no zone claimed must not reach
 * Chromium, which would otherwise navigate the window to the file. Main
 * refuses the navigation too; this keeps the drag cursor honest as well.
 */
export function installDropGuard(): () => void {
  const block = (e: DragEvent): void => e.preventDefault()
  window.addEventListener('dragover', block)
  window.addEventListener('drop', block)
  return () => {
    window.removeEventListener('dragover', block)
    window.removeEventListener('drop', block)
  }
}

const hasFiles = (e: DragEvent): boolean => Boolean(e.dataTransfer?.types.includes('Files'))

/**
 * Makes `el` a drop target for folders. `dropping` is true while a file drag is
 * over it, for the wash the zone paints. Files that are not directories are
 * filtered here for speed; main is the guarantee (see Library.addFolder).
 */
export function useFolderDrop(
  el: Ref<HTMLElement | null>,
  enabled: () => boolean = () => true,
): { dropping: Ref<boolean> } {
  const dropping = ref(false)
  // Enter/leave fire for every child crossed; the depth is what says "still inside".
  let depth = 0

  function onEnter(e: DragEvent): void {
    if (!enabled() || !hasFiles(e)) return
    e.preventDefault()
    depth++
    dropping.value = true
  }
  function onOver(e: DragEvent): void {
    if (!enabled() || !hasFiles(e)) return
    e.preventDefault()
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'link'
  }
  function onLeave(): void {
    if (!dropping.value) return
    depth = Math.max(0, depth - 1)
    if (!depth) dropping.value = false
  }
  function onDrop(e: DragEvent): void {
    if (!enabled() || !hasFiles(e)) return
    e.preventDefault()
    depth = 0
    dropping.value = false
    const files: File[] = []
    for (const item of e.dataTransfer?.items ?? []) {
      if (item.kind !== 'file') continue
      const entry = item.webkitGetAsEntry()
      if (entry && !entry.isDirectory) continue
      const file = item.getAsFile()
      if (file) files.push(file)
    }
    void addDroppedFolders(files)
  }

  function bind(target: HTMLElement): void {
    target.addEventListener('dragenter', onEnter)
    target.addEventListener('dragover', onOver)
    target.addEventListener('dragleave', onLeave)
    target.addEventListener('drop', onDrop)
  }
  function unbind(target: HTMLElement): void {
    target.removeEventListener('dragenter', onEnter)
    target.removeEventListener('dragover', onOver)
    target.removeEventListener('dragleave', onLeave)
    target.removeEventListener('drop', onDrop)
    depth = 0
    dropping.value = false
  }

  // The zone may be inside a v-if, so follow the ref rather than binding once.
  watch(
    el,
    (next, prev) => {
      if (prev) unbind(prev)
      if (next) bind(next)
    },
    { immediate: true },
  )
  onBeforeUnmount(() => {
    if (el.value) unbind(el.value)
  })

  return { dropping }
}
