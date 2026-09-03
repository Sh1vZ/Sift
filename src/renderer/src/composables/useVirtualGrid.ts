import { computed, onBeforeUnmount, onMounted, ref, type Ref } from 'vue'
import type { Clip, GridSize } from '@shared/types'
import type { Section } from './useLibrary'

export interface HeaderRow {
  kind: 'header'
  key: string
  title: string
  count: number
  top: number
  height: number
}
export interface CardRow {
  kind: 'cards'
  key: string
  clips: Clip[]
  top: number
  height: number
  cardWidth: number
  cardHeight: number
}
export type GridRow = HeaderRow | CardRow

export const GRID_PAD_X = 28
const PAD_TOP = 8
const PAD_BOTTOM = 48
const GAP = 18
/** Height reserved under each thumbnail for the title + date line, including the
 *  padding ClipCard's `.meta` sets. Change both together. */
const META_H = 70
const HEADER_H = 48
const SECTION_GAP = 14
const OVERSCAN = 420
const MIN_CARD_W: Record<GridSize, number> = { compact: 214, comfortable: 268, large: 348 }

/**
 * Windowed layout for a sectioned grid. Everything is computed from scroll
 * position + container size, so only the rows on screen (plus a small
 * overscan) ever exist in the DOM — a 5,000-clip library costs the same as a
 * 50-clip one.
 */
export function useVirtualGrid(
  container: Ref<HTMLElement | null>,
  sections: Ref<Section[]>,
  gridSize: Ref<GridSize>
) {
  const width = ref(0)
  const height = ref(0)
  const scrollTop = ref(0)
  let observer: ResizeObserver | null = null
  let raf = 0

  const onScroll = (): void => {
    if (raf) return
    raf = requestAnimationFrame(() => {
      raf = 0
      scrollTop.value = container.value?.scrollTop ?? 0
    })
  }

  onMounted(() => {
    const el = container.value
    if (!el) return
    width.value = el.clientWidth
    height.value = el.clientHeight
    observer = new ResizeObserver(() => {
      width.value = el.clientWidth
      height.value = el.clientHeight
    })
    observer.observe(el)
    el.addEventListener('scroll', onScroll, { passive: true })
  })

  onBeforeUnmount(() => {
    observer?.disconnect()
    container.value?.removeEventListener('scroll', onScroll)
    if (raf) cancelAnimationFrame(raf)
  })

  const layout = computed(() => {
    const inner = Math.max(0, width.value - GRID_PAD_X * 2)
    const cols = Math.max(1, Math.floor((inner + GAP) / (MIN_CARD_W[gridSize.value] + GAP)))
    const cardWidth = Math.floor((inner - GAP * (cols - 1)) / cols)
    const cardHeight = Math.round((cardWidth * 9) / 16) + META_H
    const rows: GridRow[] = []
    let top = PAD_TOP
    for (const s of sections.value) {
      if (s.title !== null) {
        rows.push({ kind: 'header', key: `h:${s.key}`, title: s.title, count: s.clips.length, top, height: HEADER_H })
        top += HEADER_H
      }
      for (let i = 0; i < s.clips.length; i += cols) {
        rows.push({
          kind: 'cards',
          key: `${s.key}:${i}`,
          clips: s.clips.slice(i, i + cols),
          top,
          height: cardHeight + GAP,
          cardWidth,
          cardHeight
        })
        top += cardHeight + GAP
      }
      top += SECTION_GAP
    }
    return { rows, cols, total: top + PAD_BOTTOM }
  })

  const visibleRows = computed<GridRow[]>(() => {
    const { rows } = layout.value
    const start = scrollTop.value - OVERSCAN
    const end = scrollTop.value + height.value + OVERSCAN
    let lo = 0
    let hi = rows.length
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (rows[mid].top + rows[mid].height <= start) lo = mid + 1
      else hi = mid
    }
    const out: GridRow[] = []
    for (let i = lo; i < rows.length && rows[i].top < end; i++) out.push(rows[i])
    return out
  })

  function scrollToTop(): void {
    if (container.value) container.value.scrollTop = 0
    scrollTop.value = 0
  }

  return { layout, visibleRows, scrollToTop }
}
