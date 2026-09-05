<script setup lang="ts">
import { computed } from 'vue'
import Icon from '../Icon.vue'
import CountUp from '../bits/CountUp.vue'
import SettingsPanel from './SettingsPanel.vue'
import SettingsRow from './SettingsRow.vue'
import { motionEnabled } from '@/composables/useMotion'
import { now, scan } from '@/composables/useLibrary'
import { openSettings } from '@/composables/useSettings'
import {
  bitrateTiers,
  codecs,
  libraryTotals,
  monthlyActivity,
  resolutions,
  topGames,
} from '@/composables/useStats'
import { formatBytes, formatFull, formatRelative, formatSpan } from '@/utils/format'
import { QUALITY_TIERS, type QualityTierDef } from '@/utils/quality'

const n = new Intl.NumberFormat()

interface Tile {
  icon: string
  label: string
  value: string
  /** Set for integer tiles, which count up when animations are on. */
  count?: number
}

const tiles = computed<Tile[]>(() => {
  const t = libraryTotals.value
  return [
    { icon: 'film', label: 'Clips indexed', value: n.format(t.clips), count: t.clips },
    { icon: 'gamepad', label: 'Games', value: n.format(t.games), count: t.games },
    { icon: 'clock', label: 'Total playtime', value: formatSpan(t.duration) },
    { icon: 'image', label: 'With previews', value: `${previewPct.value}%` },
  ]
})

const previewPct = computed(() => {
  const t = libraryTotals.value
  return t.clips ? Math.round((t.withPreviews / t.clips) * 100) : 0
})

/** The chart's caption names the busiest month, so the tallest bar has a number without hovering. */
const activityDescription = computed(() => {
  const peak = monthlyActivity.value.reduce((m, b) => (b.count > m.count ? b : m))
  return peak.count
    ? `Clips recorded per month over the last year. Busiest: ${peak.title}, ${peak.count} clip${peak.count === 1 ? '' : 's'}.`
    : 'Clips recorded per month over the last year.'
})

const bar = (share: number): Record<string, string> => ({ '--share': String(share) })

const tierColor = (key: string): QualityTierDef['color'] =>
  QUALITY_TIERS.find((t) => t.id === key)?.color ?? 'neutral'
</script>

<template>
  <div class="stack">
    <ul class="tiles">
      <li v-for="t in tiles" :key="t.label" class="tile">
        <span class="tile-icon"><Icon :name="t.icon" :size="18" /></span>
        <span class="tile-value mono">
          <CountUp
            v-if="t.count !== undefined && motionEnabled"
            :to="t.count"
            :duration="1.1"
            separator=","
          />
          <template v-else>{{ t.value }}</template>
        </span>
        <span class="tile-label">{{ t.label }}</span>
      </li>
    </ul>

    <Transition name="collapse">
      <div v-if="scan.active || scan.pending">
        <div class="collapse-body">
          <UAlert
            color="primary"
            variant="subtle"
            icon="i-lucide-loader-circle"
            title="Numbers are still moving"
            :description="
              scan.active
                ? `Scanning ${scan.folder} — totals grow as clips are found.`
                : `${scan.pending} clip${scan.pending === 1 ? '' : 's'} still waiting for a preview.`
            "
            :ui="{ icon: 'animate-spin' }"
          />
        </div>
      </div>
    </Transition>

    <div class="slot">
      <Transition name="dissolve">
        <div v-if="libraryTotals.clips" key="panels" class="panels">
          <SettingsPanel
            title="Library"
            description="How much of the index has been processed, and what it spans."
            flush
          >
            <SettingsRow
              id="stats-previews"
              icon="image"
              title="Previews built"
              :description="`${n.format(libraryTotals.withPreviews)} of ${n.format(libraryTotals.clips)} clips have a poster frame.`"
              :value="`${previewPct}%`"
            >
              <UProgress
                class="row-progress"
                size="xs"
                color="primary"
                :model-value="previewPct"
                :aria-label="`${previewPct}% of clips have previews`"
              />
            </SettingsRow>

            <SettingsRow
              v-if="libraryTotals.failed"
              icon="alert"
              tone="warning"
              title="Could not be read"
              description="ffprobe failed on these files. They stay in the library; the card shows a placeholder."
            >
              <template #trailing>
                <UBadge
                  color="warning"
                  variant="subtle"
                  size="sm"
                  :label="`${libraryTotals.failed} clips`"
                  class="mono"
                />
              </template>
            </SettingsRow>

            <SettingsRow
              icon="calendar"
              title="Spans"
              :description="`${formatFull(libraryTotals.oldestMs)} → ${formatFull(libraryTotals.newestMs)}`"
              :value="formatRelative(libraryTotals.newestMs, now)"
            />

            <SettingsRow
              icon="gauge"
              title="Average clip"
              description="Across every indexed recording."
              :value="`${formatBytes(libraryTotals.avgBytes)} · ${formatSpan(libraryTotals.avgDuration)}`"
            />

            <SettingsRow
              v-if="libraryTotals.largest"
              icon="trending"
              title="Biggest clip"
              :description="libraryTotals.largest.title"
              :path="libraryTotals.largest.path"
              :value="formatBytes(libraryTotals.largest.size)"
            />

            <SettingsRow
              v-if="libraryTotals.longest"
              icon="timer"
              title="Longest clip"
              :description="libraryTotals.longest.title"
              :path="libraryTotals.longest.path"
              :value="formatSpan(libraryTotals.longest.duration)"
            />

            <!-- Bytes live on the Storage pane, with the cache and the index beside them. -->
            <SettingsRow
              icon="hard-drive"
              title="Disk usage"
              description="How much the recordings, the previews and the index take on disk."
            >
              <template #trailing>
                <UButton
                  label="Open Storage"
                  trailing-icon="i-lucide-arrow-right"
                  color="neutral"
                  variant="subtle"
                  size="sm"
                  @click="openSettings('storage')"
                />
              </template>
            </SettingsRow>
          </SettingsPanel>

          <SettingsPanel title="Recording activity" :description="activityDescription">
            <ul class="months" aria-label="Clips recorded per month">
              <li
                v-for="m in monthlyActivity"
                :key="m.key"
                class="month"
                :title="`${m.title}: ${m.count} clips`"
              >
                <span class="month-track">
                  <span
                    class="month-fill"
                    :class="{ 'is-empty': !m.count }"
                    :style="bar(m.share)"
                  />
                </span>
                <span class="month-count mono">{{ m.count }}</span>
                <span class="month-label">{{ m.label }}</span>
                <span class="sr-only"
                  >{{ m.title }}: {{ m.count }} clips, {{ formatBytes(m.bytes) }}</span
                >
              </li>
            </ul>
          </SettingsPanel>

          <SettingsPanel title="Biggest games" description="Where your disk space actually goes.">
            <ul class="bars" aria-label="Games by disk space">
              <li v-for="g in topGames" :key="g.key" class="bar-row">
                <span class="bar-label truncate" :title="g.label">{{ g.label }}</span>
                <span class="bar-track">
                  <span class="bar-fill" :style="bar(g.share)" />
                </span>
                <span class="bar-value mono">{{ formatBytes(g.bytes) }}</span>
                <span class="bar-sub mono" :title="`${g.count} clips`">{{ g.count }} clips</span>
              </li>
            </ul>
          </SettingsPanel>

          <SettingsPanel
            title="Formats"
            description="Resolutions, codecs and bitrate density. Density is measured per pixel, so clips of different sizes compare fairly."
          >
            <div class="chips">
              <div class="chip-group">
                <span class="chip-title">Resolution</span>
                <div class="chip-list">
                  <UBadge
                    v-for="r in resolutions"
                    :key="r.key"
                    color="primary"
                    variant="subtle"
                    size="md"
                    :label="`${r.label} · ${n.format(r.count)}`"
                    class="mono"
                  />
                </div>
              </div>
              <div class="chip-group">
                <span class="chip-title">Codec</span>
                <div class="chip-list">
                  <UBadge
                    v-for="c in codecs"
                    :key="c.key"
                    color="neutral"
                    variant="subtle"
                    size="md"
                    :label="`${c.label} · ${n.format(c.count)}`"
                    class="mono"
                  />
                </div>
              </div>
              <div class="chip-group">
                <span class="chip-title">Bitrate</span>
                <div class="chip-list">
                  <UBadge
                    v-for="b in bitrateTiers"
                    :key="b.key"
                    :color="tierColor(b.key)"
                    variant="subtle"
                    size="md"
                    :label="`${b.label} · ${n.format(b.count)}`"
                    class="mono"
                  />
                </div>
              </div>
            </div>
          </SettingsPanel>
        </div>

        <UEmpty
          v-else
          key="empty"
          class="empty"
          icon="i-lucide-chart-column"
          title="Nothing to measure yet"
          description="Add a folder of recordings and these numbers fill in as it scans."
          variant="subtle"
          :actions="[
            {
              label: 'Go to Folders',
              icon: 'i-lucide-folder-plus',
              onClick: () => openSettings('folders'),
            },
          ]"
        />
      </Transition>
    </div>
  </div>
</template>

<style scoped>
/* Holds the box the panels and the empty state animate inside. `.panels` keeps
   the stack's own rhythm, which the wrapper would otherwise flatten. */
.slot {
  position: relative;
}
.panels {
  display: flex;
  flex-direction: column;
  gap: var(--s-5);
}

/* Headline figures: four equal tiles that drop to two columns when narrow. */
.tiles {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: var(--s-3);
  list-style: none;
  margin: 0;
  padding: 0;
}
.tile {
  display: flex;
  flex-direction: column;
  gap: var(--s-1);
  padding: var(--s-4);
  border-radius: var(--r-lg);
  background: var(--bg-3);
  border: 1px solid var(--border);
  box-shadow: var(--shadow-sm);
}
.tile-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  margin-bottom: var(--s-1);
  border-radius: var(--r-md);
  background: var(--primary-soft);
  color: var(--secondary);
}
.tile-value {
  font-family: var(--font-heading);
  font-size: var(--text-xl);
  font-weight: 700;
  line-height: 1.15;
}
.tile-label {
  font-size: var(--text-sm);
  color: var(--fg-muted);
}

.row-progress {
  margin-top: var(--s-2);
  max-width: 320px;
}
.empty {
  padding: var(--s-8) var(--s-6);
}

/* Twelve-month column chart. Bars scale on the Y axis so nothing reflows. */
.months {
  display: flex;
  align-items: flex-end;
  gap: var(--s-2);
  list-style: none;
  margin: 0;
  padding: 0;
}
.month {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--s-1);
}
.month-track {
  display: block;
  width: 100%;
  height: 96px;
  border-radius: var(--r-sm);
  background: var(--bg-2);
  overflow: hidden;
}
.month-fill {
  display: block;
  width: 100%;
  height: 100%;
  transform: scaleY(var(--share));
  transform-origin: bottom;
  transition: transform var(--dur) var(--ease-out);
  background: linear-gradient(180deg, var(--secondary), var(--primary));
}
.month-fill.is-empty {
  /* A month with no clips still needs a visible baseline. */
  transform: scaleY(0.02);
  background: var(--bg-4);
}
.month-count {
  font-size: var(--text-sm);
  font-weight: 600;
  color: var(--fg);
}
.month-label {
  font-size: var(--text-xs);
  color: var(--fg-muted);
}

/* Horizontal ranking bars. */
.bars {
  list-style: none;
  margin: 0;
  padding: 0;
}
.bar-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 2.2fr auto 72px;
  align-items: center;
  gap: var(--s-3);
}
.bar-row + .bar-row {
  margin-top: var(--s-3);
}
.bar-label {
  font-size: var(--text-sm);
  font-weight: 600;
}
.bar-track {
  height: 10px;
  border-radius: var(--r-full);
  background: var(--bg-2);
  overflow: hidden;
}
.bar-fill {
  display: block;
  width: 100%;
  height: 100%;
  border-radius: var(--r-full);
  transform: scaleX(var(--share));
  transform-origin: left;
  transition: transform var(--dur) var(--ease-out);
  background: linear-gradient(90deg, var(--primary), var(--secondary));
}
.bar-value {
  font-size: var(--text-sm);
  color: var(--fg);
}
.bar-sub {
  font-size: var(--text-sm);
  color: var(--fg-muted);
  text-align: right;
  white-space: nowrap;
}

.chips {
  display: flex;
  flex-direction: column;
  gap: var(--s-4);
}
.chip-title {
  display: block;
  margin-bottom: var(--s-2);
  font-family: var(--font-heading);
  font-size: var(--text-xs);
  font-weight: 600;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--fg-muted);
}
.chip-list {
  display: flex;
  flex-wrap: wrap;
  gap: var(--s-2);
}
</style>
