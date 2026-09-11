import { computed, ref } from 'vue'
import type { Clip, GifPreview } from '@shared/types'
import { inSec, outSec, submitGif } from './useEditor'
import { settings } from './useLibrary'

const api = window.api

/** A preview from the ask to the file, as the dialog shows it. */
export interface GifPreviewState {
  clip: Clip
  start: number
  end: number
  /** Frame size the GIF has: the pick, or the source's own width where that is narrower. */
  width: number
  height: number
  fps: number
  state: 'rendering' | 'ready' | 'failed'
  /** 0..1 while rendering. */
  progress: number
  preview?: GifPreview
  error?: string
}

/**
 * The GIF preview dialog's state: the preview on screen, or null while it is
 * closed. Main renders the file the export would write into the cache; Save
 * then runs the ordinary GIF export, which copies that file instead of
 * rendering it again (see `previewGif` in the Api).
 */
export const gifPreview = ref<GifPreviewState | null>(null)
export const gifPreviewOpen = computed(() => gifPreview.value !== null)
/** The rendered file, for the dialog's <img>. */
export const gifPreviewSrc = computed(() => {
  const file = gifPreview.value?.preview?.file
  return file ? api.thumbUrl(file) : ''
})

/** Which ask the dialog is showing; an answer to an older one is dropped. */
let ask = 0

/** The frame size the export's scale filter lands on: never up, and the height kept even. */
export function gifFrameSize(clip: Clip, width: number): { width: number; height: number } {
  const w = Math.min(clip.width, width)
  const h = 2 * Math.round((clip.height * w) / clip.width / 2)
  return { width: w, height: h }
}

export function initGifPreview(): void {
  api.on('gif-preview:progress', ({ id, progress }) => {
    const cur = gifPreview.value
    if (cur?.state === 'rendering' && cur.clip.id === id) cur.progress = progress
  })
}

/** Renders the selection at the trim row's GIF settings and opens the dialog on it. */
export async function openGifPreview(clip: Clip): Promise<void> {
  const req = {
    id: clip.id,
    start: inSec.value,
    end: outSec.value,
    width: settings.value.gifWidth,
    fps: settings.value.gifFps,
  }
  const mine = ++ask
  gifPreview.value = {
    clip,
    start: req.start,
    end: req.end,
    ...gifFrameSize(clip, req.width),
    fps: req.fps,
    state: 'rendering',
    progress: 0,
  }
  const res = await api.clips.previewGif(req)
  const cur = gifPreview.value
  if (mine !== ask || !cur) return
  if (res.ok && res.preview) {
    cur.state = 'ready'
    cur.progress = 1
    cur.preview = res.preview
  } else if (res.cancelled) {
    // Main stopped it under us (only ever at shutdown): nothing to show.
    closeGifPreview()
  } else {
    cur.state = 'failed'
    cur.error = res.error
  }
}

/** Closes the dialog; a render still under way is stopped. */
export function closeGifPreview(): void {
  const cur = gifPreview.value
  if (!cur) return
  ask++
  gifPreview.value = null
  if (cur.state === 'rendering') void api.clips.cancelGifPreview()
}

/** Saves the GIF just looked at: the save dialog, then an export that copies the file. */
export async function saveGifPreview(): Promise<void> {
  const cur = gifPreview.value
  if (cur?.state !== 'ready') return
  closeGifPreview()
  await submitGif(cur.clip)
}

/** Another go after a failure. */
export function retryGifPreview(): void {
  const clip = gifPreview.value?.clip
  if (clip) void openGifPreview(clip)
}
