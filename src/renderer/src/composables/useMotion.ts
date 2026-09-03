import gsap from 'gsap'
import { computed, ref, watchEffect } from 'vue'
import { settings } from './useLibrary'

const mql = window.matchMedia('(prefers-reduced-motion: reduce)')
const osReduced = ref(mql.matches)
mql.addEventListener('change', (e) => (osReduced.value = e.matches))

/** True when both the user setting and the OS allow non-essential motion. */
export const motionEnabled = computed(() => settings.value.animations && !osReduced.value)

watchEffect(() => {
  document.documentElement.classList.toggle('no-motion', !motionEnabled.value)
})

export interface Rect {
  left: number
  top: number
  width: number
  height: number
}

/** Wave-stagger a set of cards into place (ui-ux-pro-max "Stagger List" preset). */
export function staggerIn(elements: Element[]): void {
  if (!elements.length) return
  if (!motionEnabled.value) {
    gsap.set(elements, { clearProps: 'opacity,transform' })
    return
  }
  gsap.killTweensOf(elements)
  gsap.fromTo(
    elements,
    { opacity: 0, y: 14, scale: 0.96 },
    {
      opacity: 1,
      y: 0,
      scale: 1,
      duration: 0.42,
      ease: 'back.out(1.4)',
      stagger: { each: 0.028, from: 'start', grid: 'auto' },
      overwrite: true,
      clearProps: 'opacity,transform'
    }
  )
}

/**
 * FLIP-style zoom: the element starts where `from` was on screen and settles
 * into its natural layout position. Only transform/opacity are animated so
 * the work stays on the compositor.
 */
export function flipFrom(el: HTMLElement, from: Rect | null, onDone?: () => void): void {
  const to = el.getBoundingClientRect()
  if (!from || !motionEnabled.value || !to.width || !to.height) {
    gsap.set(el, { clearProps: 'transform,opacity' })
    onDone?.()
    return
  }
  gsap.set(el, { transformOrigin: '0 0' })
  gsap.fromTo(
    el,
    {
      x: from.left - to.left,
      y: from.top - to.top,
      scaleX: from.width / to.width,
      scaleY: from.height / to.height,
      opacity: 0.6
    },
    {
      x: 0,
      y: 0,
      scaleX: 1,
      scaleY: 1,
      opacity: 1,
      duration: 0.46,
      ease: 'power3.out',
      clearProps: 'transform,opacity',
      onComplete: onDone
    }
  )
}

export function flipTo(el: HTMLElement, to: Rect | null, onDone: () => void): void {
  const from = el.getBoundingClientRect()
  if (!to || !motionEnabled.value || !from.width || !from.height) {
    onDone()
    return
  }
  gsap.set(el, { transformOrigin: '0 0' })
  gsap.to(el, {
    x: to.left - from.left,
    y: to.top - from.top,
    scaleX: to.width / from.width,
    scaleY: to.height / from.height,
    opacity: 0,
    duration: 0.3,
    ease: 'power2.in',
    onComplete: onDone
  })
}

export function fadeOut(el: HTMLElement, onDone: () => void): void {
  if (!motionEnabled.value) return onDone()
  gsap.to(el, { opacity: 0, duration: 0.18, ease: 'power1.out', onComplete: onDone })
}
