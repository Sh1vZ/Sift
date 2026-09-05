import type { ThemeId } from './types'

/**
 * The brand colours of each theme — the identity gradient (secondary → primary),
 * the glyph colour that sits on it, and the accent. `tokens.css` is still the
 * source of truth for the renderer; this table mirrors just the four values
 * that have to be known outside CSS: the renderer's theme previews and Vue Bits
 * props, and the main process, which draws the taskbar and tray icon from them
 * (see main/lib/icon.ts). Keep it in step with the `html[data-theme]` blocks.
 */
export interface ThemeBrand {
  primary: string
  secondary: string
  accent: string
  /** Glyphs on a primary fill (`--on-primary`): white, or near-black on the light identities. */
  onPrimary: string
}

export const THEME_BRAND: Record<ThemeId, ThemeBrand> = {
  sift: { primary: '#7c3aed', secondary: '#a78bfa', accent: '#f43f5e', onPrimary: '#ffffff' },
  ember: { primary: '#f97316', secondary: '#fdba74', accent: '#facc15', onPrimary: '#ffffff' },
  synthwave: { primary: '#ec4899', secondary: '#f9a8d4', accent: '#22d3ee', onPrimary: '#ffffff' },
  crimson: { primary: '#dc2626', secondary: '#fca5a5', accent: '#fbbf24', onPrimary: '#ffffff' },
  solar: { primary: '#eab308', secondary: '#fde047', accent: '#38bdf8', onPrimary: '#1c1a0e' },
  nox: { primary: '#b01ea4', secondary: '#ee9ae7', accent: '#fbbf24', onPrimary: '#ffffff' },
  grim: { primary: '#9ec5ab', secondary: '#c6dfd1', accent: '#e0705c', onPrimary: '#011502' },
  space: { primary: '#4361ee', secondary: '#9db1ff', accent: '#ffc94a', onPrimary: '#ffffff' },
  oled: { primary: '#7c3aed', secondary: '#a78bfa', accent: '#f43f5e', onPrimary: '#ffffff' },
  'oled-mint': {
    primary: '#10b981',
    secondary: '#6ee7b7',
    accent: '#f472b6',
    onPrimary: '#ffffff',
  },
  'oled-frost': {
    primary: '#06b6d4',
    secondary: '#67e8f9',
    accent: '#a78bfa',
    onPrimary: '#ffffff',
  },
  'oled-crimson': {
    primary: '#dc2626',
    secondary: '#fca5a5',
    accent: '#fbbf24',
    onPrimary: '#ffffff',
  },
}
