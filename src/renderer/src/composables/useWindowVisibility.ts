import { nextTick, ref } from 'vue'
import { startClock, stopClock } from './useLibrary'

/**
 * Whether the window is on screen. False while it is hidden to the tray or
 * minimized, which is when the renderer releases everything expensive: the
 * player's decoder, the grid rows, the game covers and Chromium's image cache.
 *
 * Driven by an explicit event from main rather than `document.visibilitychange`
 * on purpose. Chromium marks an *occluded* window hidden too, so a maximized
 * game covering Sift would tear the player down and blank the grid behind it,
 * then flap on every transient overlay. Main knows which one it is for free.
 *
 * Nothing that affects correctness may depend on this — it only gates work.
 */
export const visible = ref(true)

export function initWindowVisibility(): void {
  window.api.on('window:visible', async (v) => {
    if (v === visible.value) return
    visible.value = v
    if (v) {
      startClock()
      return
    }
    stopClock()
    // Order matters: let Vue detach the rows, the covers and the video source
    // first, so the cache entries they were holding are actually droppable.
    // nextTick and not requestAnimationFrame — rAF is paused for a hidden
    // window, so a frame callback scheduled here would never run.
    await nextTick()
    window.api.window.clearCache()
  })
}
