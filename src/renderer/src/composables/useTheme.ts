import { LAST_THEME_KEY, THEME_IDS, type ThemeId } from "@shared/types";
import { computed, watchEffect } from "vue";
import { settings, updateSettings } from "./useLibrary";

/**
 * Themes are CSS-only: `tokens.css` carries one `html[data-theme]` block per id
 * and this module just keeps the attribute in step with the setting. The hex
 * values here mirror those blocks for the two places CSS variables cannot
 * reach — the theme picker's previews, and the Vue Bits props that take a
 * colour string (WebGL aurora, folder, sliders, list fades).
 */
export interface ThemeDef {
  id: ThemeId;
  name: string;
  description: string;
  /** True-black surfaces, listed under their own heading in the picker. */
  oled: boolean;
  colors: {
    bg0: string;
    bg1: string;
    bg3: string;
    fg: string;
    primary: string;
    secondary: string;
    accent: string;
  };
  /** Cursor spotlight on game cards: the secondary colour at low alpha. */
  spotlight: string;
}

const OLED_SURFACES = { bg0: "#000000", bg1: "#000000", bg3: "#121212" };

export const THEMES: ThemeDef[] = [
  {
    id: "sift",
    name: "Sift",
    description:
      "The default. Indigo-black surfaces, neon violet identity, rose held in reserve.",
    oled: false,
    colors: {
      bg0: "#0a0a18",
      bg1: "#0f0f23",
      bg3: "#1e1c35",
      fg: "#e2e8f0",
      primary: "#7c3aed",
      secondary: "#a78bfa",
      accent: "#f43f5e",
    },
    spotlight: "rgba(167, 139, 250, 0.28)",
  },
  {
    id: "ember",
    name: "Ember",
    description:
      "Warm charcoal ground with an orange identity and gold punctuation.",
    oled: false,
    colors: {
      bg0: "#0b0807",
      bg1: "#110e0c",
      bg3: "#221c19",
      fg: "#f2ebe6",
      primary: "#f97316",
      secondary: "#fdba74",
      accent: "#facc15",
    },
    spotlight: "rgba(253, 186, 116, 0.26)",
  },
  {
    id: "synthwave",
    name: "Synthwave",
    description:
      "Deep purple ground with a hot pink identity and cyan punctuation.",
    oled: false,
    colors: {
      bg0: "#0b0516",
      bg1: "#10081d",
      bg3: "#22123a",
      fg: "#f3e8ff",
      primary: "#ec4899",
      secondary: "#f9a8d4",
      accent: "#22d3ee",
    },
    spotlight: "rgba(249, 168, 212, 0.26)",
  },
  {
    id: "crimson",
    name: "Crimson",
    description:
      "Red-black ground with a crimson identity and amber punctuation.",
    oled: false,
    colors: {
      bg0: "#0f0708",
      bg1: "#150a0c",
      bg3: "#271418",
      fg: "#f5e9eb",
      primary: "#dc2626",
      secondary: "#fca5a5",
      accent: "#fbbf24",
    },
    spotlight: "rgba(252, 165, 165, 0.24)",
  },
  {
    id: "solar",
    name: "Solar",
    description:
      "Warm graphite ground with a golden identity and sky punctuation.",
    oled: false,
    colors: {
      bg0: "#0a0a08",
      bg1: "#10100d",
      bg3: "#21211b",
      fg: "#f0efe8",
      primary: "#eab308",
      secondary: "#fde047",
      accent: "#38bdf8",
    },
    spotlight: "rgba(253, 224, 71, 0.22)",
  },
  {
    id: "nox",
    name: "Nox",
    description:
      "Deep plum ground with a magenta identity and amber punctuation.",
    oled: false,
    colors: {
      bg0: "#1a0916",
      bg1: "#150811",
      bg3: "#26081c",
      fg: "#f6ecf3",
      primary: "#b01ea4",
      secondary: "#ee9ae7",
      accent: "#fbbf24",
    },
    spotlight: "rgba(238, 154, 231, 0.24)",
  },
  {
    id: "grim",
    name: "Grim",
    description:
      "Near-black forest ground with a sage identity and terracotta punctuation.",
    oled: false,
    colors: {
      bg0: "#011502",
      bg1: "#000a01",
      bg3: "#01200f",
      fg: "#e8f2ea",
      primary: "#9ec5ab",
      secondary: "#c6dfd1",
      accent: "#e0705c",
    },
    spotlight: "rgba(158, 197, 171, 0.24)",
  },
  {
    id: "space",
    name: "Space",
    description:
      "Deep-space navy ground with a cosmic blue identity and starlight gold punctuation.",
    oled: false,
    colors: {
      bg0: "#060b1c",
      bg1: "#0a1128",
      bg3: "#16224a",
      fg: "#e8ecfb",
      primary: "#4361ee",
      secondary: "#9db1ff",
      accent: "#ffc94a",
    },
    spotlight: "rgba(157, 177, 255, 0.26)",
  },
  {
    id: "oled",
    name: "OLED",
    description:
      "True black surfaces so unlit pixels stay off, with the violet and rose glow kept.",
    oled: true,
    colors: {
      ...OLED_SURFACES,
      fg: "#e2e8f0",
      primary: "#7c3aed",
      secondary: "#a78bfa",
      accent: "#f43f5e",
    },
    spotlight: "rgba(167, 139, 250, 0.28)",
  },
  {
    id: "oled-mint",
    name: "OLED Mint",
    description:
      "True black with an emerald identity, pink punctuation and a matching glow.",
    oled: true,
    colors: {
      ...OLED_SURFACES,
      fg: "#e6f0ea",
      primary: "#10b981",
      secondary: "#6ee7b7",
      accent: "#f472b6",
    },
    spotlight: "rgba(110, 231, 183, 0.24)",
  },
  {
    id: "oled-frost",
    name: "OLED Frost",
    description:
      "True black with a cyan identity, violet punctuation and a matching glow.",
    oled: true,
    colors: {
      ...OLED_SURFACES,
      fg: "#e4f0f4",
      primary: "#06b6d4",
      secondary: "#67e8f9",
      accent: "#a78bfa",
    },
    spotlight: "rgba(103, 232, 249, 0.24)",
  },
  {
    id: "oled-crimson",
    name: "OLED Crimson",
    description:
      "True black with a crimson identity, amber punctuation and a matching glow.",
    oled: true,
    colors: {
      ...OLED_SURFACES,
      fg: "#f5e9eb",
      primary: "#dc2626",
      secondary: "#fca5a5",
      accent: "#fbbf24",
    },
    spotlight: "rgba(252, 165, 165, 0.24)",
  },
];

const DEFAULT_THEME = THEMES[0];

function isThemeId(v: unknown): v is ThemeId {
  return typeof v === "string" && (THEME_IDS as readonly string[]).includes(v);
}

function applyTheme(id: ThemeId): void {
  document.documentElement.dataset.theme = id;
}

// The persisted setting only arrives with the library snapshot, a beat after
// mount. Re-applying the last known theme first keeps an OLED user from
// seeing an indigo flash on every launch. Storage can be unavailable in odd
// profiles, and that is non-fatal: the snapshot corrects it moments later.
try {
  const last = localStorage.getItem(LAST_THEME_KEY);
  if (isThemeId(last)) applyTheme(last);
} catch {
  /* no early theme — the snapshot will set it */
}

export const activeTheme = computed<ThemeDef>(
  () => THEMES.find((t) => t.id === settings.value.theme) ?? DEFAULT_THEME,
);

watchEffect(() => {
  const id = activeTheme.value.id;
  applyTheme(id);
  try {
    localStorage.setItem(LAST_THEME_KEY, id);
  } catch {
    /* non-fatal: the setting itself is persisted by the main process */
  }
});

export function setTheme(id: ThemeId): Promise<void> {
  return updateSettings({ theme: id });
}
