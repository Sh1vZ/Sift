<script setup lang="ts">
import { computed } from 'vue'
import SettingsPanel from './SettingsPanel.vue'
import { activeTheme, setTheme, THEMES, type ThemeDef } from '@/composables/useTheme'

const DEFAULT_ID = THEMES[0].id
const isDefault = computed(() => activeTheme.value.id === DEFAULT_ID)

const standard = THEMES.filter((t) => !t.oled)
const oled = THEMES.filter((t) => t.oled)

const isActive = (t: ThemeDef): boolean => t.id === activeTheme.value.id
</script>

<template>
  <div class="stack">
    <SettingsPanel
      title="Theme"
      description="Applies straight away and is saved with your other preferences. Only the chrome changes — clips are never tinted."
    >
      <template #actions>
        <UButton
          v-if="!isDefault"
          color="neutral"
          variant="subtle"
          size="sm"
          icon="i-lucide-rotate-ccw"
          label="Reset"
          @click="setTheme(DEFAULT_ID)"
        />
      </template>

      <div class="themes" role="group" aria-label="Theme">
        <button
          v-for="t in standard"
          :key="t.id"
          type="button"
          class="theme"
          :class="{ 'is-active': isActive(t) }"
          :aria-pressed="isActive(t)"
          :aria-label="`${t.name} theme`"
          @click="setTheme(t.id)"
        >
          <!-- A miniature of the shell: rail, two cards, a primary pill and an
               accent dot. Colours are the theme's own hexes, not the live tokens,
               so every preview shows itself rather than the current theme. -->
          <span class="preview" :style="{ background: t.colors.bg1 }" aria-hidden="true">
            <span class="pv-rail" :style="{ background: t.colors.bg0 }">
              <span class="pv-mark" :style="{ background: t.colors.primary }" />
            </span>
            <span class="pv-body">
              <span class="pv-bar">
                <span class="pv-pill" :style="{ background: t.colors.primary }" />
                <span class="pv-dot" :style="{ background: t.colors.accent }" />
              </span>
              <span class="pv-cards">
                <span class="pv-card" :style="{ background: t.colors.bg3 }">
                  <span class="pv-thumb" :style="{ background: t.colors.bg0 }" />
                  <span class="pv-line" :style="{ background: t.colors.fg }" />
                </span>
                <span class="pv-card" :style="{ background: t.colors.bg3 }">
                  <span class="pv-thumb" :style="{ background: t.colors.bg0 }" />
                  <span class="pv-line" :style="{ background: t.colors.secondary }" />
                </span>
              </span>
            </span>
          </span>

          <span class="meta">
            <span class="name-row">
              <span class="name">{{ t.name }}</span>
              <UBadge
                v-if="t.id === DEFAULT_ID"
                color="neutral"
                variant="subtle"
                size="xs"
                label="Default"
              />
              <UIcon v-if="isActive(t)" name="i-lucide-check" class="check" />
            </span>
            <span class="desc">{{ t.description }}</span>
          </span>
        </button>
      </div>
    </SettingsPanel>

    <SettingsPanel
      title="OLED themes"
      description="Pure black surfaces, so an OLED panel switches those pixels off. The brand glow stays, tinted to match."
    >
      <div class="themes" role="group" aria-label="OLED theme">
        <button
          v-for="t in oled"
          :key="t.id"
          type="button"
          class="theme"
          :class="{ 'is-active': isActive(t) }"
          :aria-pressed="isActive(t)"
          :aria-label="`${t.name} theme`"
          @click="setTheme(t.id)"
        >
          <span class="preview" :style="{ background: t.colors.bg1 }" aria-hidden="true">
            <span class="pv-rail" :style="{ background: t.colors.bg0 }">
              <span class="pv-mark" :style="{ background: t.colors.primary }" />
            </span>
            <span class="pv-body">
              <span class="pv-bar">
                <span class="pv-pill" :style="{ background: t.colors.primary }" />
                <span class="pv-dot" :style="{ background: t.colors.accent }" />
              </span>
              <span class="pv-cards">
                <span class="pv-card" :style="{ background: t.colors.bg3 }">
                  <span class="pv-thumb" :style="{ background: t.colors.bg0 }" />
                  <span class="pv-line" :style="{ background: t.colors.fg }" />
                </span>
                <span class="pv-card" :style="{ background: t.colors.bg3 }">
                  <span class="pv-thumb" :style="{ background: t.colors.bg0 }" />
                  <span class="pv-line" :style="{ background: t.colors.secondary }" />
                </span>
              </span>
            </span>
          </span>

          <span class="meta">
            <span class="name-row">
              <span class="name">{{ t.name }}</span>
              <UIcon v-if="isActive(t)" name="i-lucide-check" class="check" />
            </span>
            <span class="desc">{{ t.description }}</span>
          </span>
        </button>
      </div>
    </SettingsPanel>
  </div>
</template>

<style scoped>
.themes {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(min(100%, 200px), 1fr));
  gap: var(--s-4);
}

.theme {
  display: flex;
  flex-direction: column;
  gap: var(--s-3);
  padding: var(--s-3);
  text-align: left;
  cursor: pointer;
  border-radius: var(--r-lg);
  border: 1px solid var(--border);
  background: var(--bg-2);
  box-shadow: var(--shadow-sm);
  transition:
    border-color var(--dur-fast) var(--ease-out),
    box-shadow var(--dur-fast) var(--ease-out),
    transform var(--dur-fast) var(--ease-out);
}
.theme:hover {
  border-color: var(--border-hover);
  transform: translateY(-2px);
}
.theme.is-active {
  border-color: var(--border-active);
  box-shadow: var(--glow-primary);
}

/* Preview miniature. Sized by aspect so the grid never shifts between themes.
   The OLED previews are black on black, so the hairline is what draws them. */
.preview {
  display: flex;
  aspect-ratio: 16 / 10;
  overflow: hidden;
  border-radius: var(--r-md);
  border: 1px solid var(--border-hover);
}
.pv-rail {
  display: flex;
  justify-content: center;
  width: 16%;
  padding-top: 8%;
}
.pv-mark {
  width: 40%;
  aspect-ratio: 1;
  border-radius: 3px;
}
.pv-body {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 8%;
  padding: 8%;
}
.pv-bar {
  display: flex;
  align-items: center;
  gap: 6%;
}
.pv-pill {
  width: 34%;
  height: 6px;
  border-radius: var(--r-full);
}
.pv-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
}
.pv-cards {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8%;
}
.pv-card {
  display: flex;
  flex-direction: column;
  gap: 12%;
  padding: 8%;
  border-radius: 4px;
}
.pv-thumb {
  aspect-ratio: 16 / 9;
  border-radius: 2px;
}
.pv-line {
  width: 70%;
  height: 3px;
  border-radius: var(--r-full);
  opacity: 0.85;
}

.meta {
  display: flex;
  flex-direction: column;
  gap: var(--s-1);
  min-width: 0;
}
.name-row {
  display: flex;
  align-items: center;
  gap: var(--s-2);
}
.name {
  font-family: var(--font-heading);
  font-size: var(--text-md);
  font-weight: 600;
  color: var(--fg);
}
.check {
  width: 16px;
  height: 16px;
  margin-left: auto;
  color: var(--secondary);
}
.desc {
  font-size: var(--text-sm);
  line-height: 1.45;
  color: var(--fg-muted);
}
</style>
