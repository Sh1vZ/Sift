<script setup lang="ts">
import { computed, onMounted } from 'vue'
import Icon from './Icon.vue'
import CountUp from './bits/CountUp.vue'
import { motionEnabled } from '@/composables/useMotion'
import { now, scan, view } from '@/composables/useLibrary'
import {
  appStats,
  codecs,
  libraryTotals,
  monthlyActivity,
  refreshStats,
  resolutions,
  revealAppData,
  statsError,
  statsLoading,
  topGames
} from '@/composables/useStats'
import { formatBytes, formatFull, formatRelative, formatSpan } from '@/utils/format'

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
    { icon: 'hard-drive', label: 'Library on disk', value: formatBytes(t.bytes) },
    { icon: 'clock', label: 'Total playtime', value: formatSpan(t.duration) },
    { icon: 'gamepad', label: 'Games', value: n.format(t.games), count: t.games }
  ]
})

/** Everything Sift itself keeps under the app-data folder. */
const appDataBytes = computed(() => {
  const s = appStats.value?.storage
  if (!s) return 0
  return s.databaseBytes + s.cacheBytes + s.otherBytes
})

const diskUsedPct = computed(() => {
  const s = appStats.value?.storage
  if (!s?.diskTotalBytes) return 0
  return Math.round(((s.diskTotalBytes - s.diskFreeBytes) / s.diskTotalBytes) * 100)
})

const previewPct = computed(() => {
  const t = libraryTotals.value
  return t.clips ? Math.round((t.withPreviews / t.clips) * 100) : 0
})

const measuredLabel = computed(() =>
  appStats.value ? `Measured ${formatRelative(appStats.value.generatedAtMs, now.value).toLowerCase()}` : 'Measuring…'
)

const bar = (share: number): Record<string, string> => ({ '--share': String(share) })

const goSettings = (): void => {
  view.value = 'folders'
}

onMounted(() => void refreshStats())
</script>

<template>
  <section class="view">
    <div class="scroll">
      <!-- Text-led screen: one centred reading column, matching Library & settings. -->
      <div class="page">
        <header class="head">
          <div>
            <h1>Stats</h1>
            <p class="sub">What Sift has indexed, and what it keeps on your disk.</p>
          </div>
          <UButton
            icon="i-lucide-refresh-cw"
            label="Refresh"
            color="neutral"
            variant="subtle"
            size="lg"
            :loading="statsLoading"
            @click="refreshStats()"
          />
        </header>

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

        <UAlert
          v-if="scan.active || scan.pending"
          class="notice"
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

        <!-- ------------------------------------------------------- storage -->
        <UCard class="panel" :ui="{ body: 'p-0 sm:p-0' }">
          <template #header>
            <h2 class="panel-title">Storage</h2>
            <p class="panel-sub">
              Your recordings stay where they are. Only the index and the generated previews
              belong to Sift.
            </p>
          </template>

          <UAlert
            v-if="statsError"
            class="panel-alert"
            color="warning"
            variant="subtle"
            icon="i-lucide-triangle-alert"
            title="Could not measure the app data folder"
            :description="statsError"
            :actions="[{ label: 'Try again', color: 'neutral', variant: 'subtle', onClick: () => refreshStats() }]"
          />
          <div v-else-if="!appStats" class="rows">
            <div v-for="i in 4" :key="i" class="row">
              <USkeleton class="size-9 rounded-lg" />
              <div class="row-text">
                <USkeleton class="h-4 w-40" />
                <USkeleton class="mt-2 h-3 w-64" />
              </div>
              <USkeleton class="h-5 w-16" />
            </div>
          </div>
          <div v-else class="rows">
            <div class="row">
              <span class="row-icon"><Icon name="film" :size="18" /></span>
              <div class="row-text">
                <span class="row-title">Clips on disk</span>
                <p class="row-desc">
                  Across {{ libraryTotals.folders }} watched folder{{ libraryTotals.folders === 1 ? '' : 's' }}.
                  Indexed in place — never copied, moved or re-encoded.
                </p>
              </div>
              <span class="row-value mono">{{ formatBytes(libraryTotals.bytes) }}</span>
            </div>

            <div class="row">
              <span class="row-icon"><Icon name="image" :size="18" /></span>
              <div class="row-text">
                <span class="row-title">Preview cache</span>
                <p class="row-desc">
                  {{ n.format(appStats.storage.cacheFiles) }} poster frames and hover-scrub strips,
                  generated once and reused.
                </p>
              </div>
              <span class="row-value mono">{{ formatBytes(appStats.storage.cacheBytes) }}</span>
            </div>

            <div class="row">
              <span class="row-icon"><Icon name="database" :size="18" /></span>
              <div class="row-text">
                <span class="row-title">Index database</span>
                <p class="row-desc">
                  SQLite record of {{ n.format(libraryTotals.clips) }} clip{{ libraryTotals.clips === 1 ? '' : 's' }},
                  including the write-ahead log.
                </p>
              </div>
              <span class="row-value mono">{{ formatBytes(appStats.storage.databaseBytes) }}</span>
            </div>

            <div class="row">
              <span class="row-icon"><Icon name="box" :size="18" /></span>
              <div class="row-text">
                <span class="row-title">App data</span>
                <p class="row-desc truncate" :title="appStats.storage.userDataPath">
                  {{ appStats.storage.userDataPath }}
                </p>
              </div>
              <span class="row-value mono">{{ formatBytes(appDataBytes) }}</span>
              <UTooltip text="Open in File Explorer">
                <UButton
                  class="row-action"
                  icon="i-lucide-folder-open"
                  color="neutral"
                  variant="ghost"
                  square
                  aria-label="Open app data folder"
                  @click="revealAppData()"
                />
              </UTooltip>
            </div>

            <div v-if="appStats.storage.diskTotalBytes" class="row">
              <span class="row-icon"><Icon name="gauge" :size="18" /></span>
              <div class="row-text">
                <span class="row-title">Free on this drive</span>
                <p class="row-desc">
                  {{ formatBytes(appStats.storage.diskFreeBytes) }} free of
                  {{ formatBytes(appStats.storage.diskTotalBytes) }} · {{ diskUsedPct }}% used
                </p>
                <UProgress
                  class="row-progress"
                  size="xs"
                  :model-value="diskUsedPct"
                  :color="diskUsedPct >= 90 ? 'warning' : 'primary'"
                  :aria-label="`Drive ${diskUsedPct}% full`"
                />
              </div>
            </div>
          </div>
        </UCard>

        <template v-if="libraryTotals.clips">
          <!-- ------------------------------------------------------ library -->
          <UCard class="panel" :ui="{ body: 'p-0 sm:p-0' }">
            <template #header>
              <h2 class="panel-title">Library</h2>
              <p class="panel-sub">How much of the index has been processed, and what it spans.</p>
            </template>

            <div class="rows">
              <div class="row">
                <span class="row-icon"><Icon name="image" :size="18" /></span>
                <div class="row-text">
                  <span class="row-title">Previews built</span>
                  <p class="row-desc">
                    {{ n.format(libraryTotals.withPreviews) }} of {{ n.format(libraryTotals.clips) }} clips have a
                    poster frame.
                  </p>
                  <UProgress
                    class="row-progress"
                    size="xs"
                    color="primary"
                    :model-value="previewPct"
                    :aria-label="`${previewPct}% of clips have previews`"
                  />
                </div>
                <span class="row-value mono">{{ previewPct }}%</span>
              </div>

              <div v-if="libraryTotals.failed" class="row">
                <span class="row-icon is-warning"><Icon name="alert" :size="18" /></span>
                <div class="row-text">
                  <span class="row-title">Could not be read</span>
                  <p class="row-desc">
                    ffprobe failed on these files. They stay in the library; the card shows a placeholder.
                  </p>
                </div>
                <UBadge color="warning" variant="subtle" size="sm" :label="`${libraryTotals.failed} clips`" class="mono" />
              </div>

              <div class="row">
                <span class="row-icon"><Icon name="calendar" :size="18" /></span>
                <div class="row-text">
                  <span class="row-title">Spans</span>
                  <p class="row-desc">
                    {{ formatFull(libraryTotals.oldestMs) }} → {{ formatFull(libraryTotals.newestMs) }}
                  </p>
                </div>
                <span class="row-value mono">{{ formatRelative(libraryTotals.newestMs, now) }}</span>
              </div>

              <div class="row">
                <span class="row-icon"><Icon name="gauge" :size="18" /></span>
                <div class="row-text">
                  <span class="row-title">Average clip</span>
                  <p class="row-desc">Across every indexed recording.</p>
                </div>
                <span class="row-value mono">
                  {{ formatBytes(libraryTotals.avgBytes) }} · {{ formatSpan(libraryTotals.avgDuration) }}
                </span>
              </div>

              <div v-if="libraryTotals.largest" class="row">
                <span class="row-icon"><Icon name="trending" :size="18" /></span>
                <div class="row-text">
                  <span class="row-title">Biggest clip</span>
                  <p class="row-desc truncate" :title="libraryTotals.largest.path">
                    {{ libraryTotals.largest.title }}
                  </p>
                </div>
                <span class="row-value mono">{{ formatBytes(libraryTotals.largest.size) }}</span>
              </div>

              <div v-if="libraryTotals.longest" class="row">
                <span class="row-icon"><Icon name="timer" :size="18" /></span>
                <div class="row-text">
                  <span class="row-title">Longest clip</span>
                  <p class="row-desc truncate" :title="libraryTotals.longest.path">
                    {{ libraryTotals.longest.title }}
                  </p>
                </div>
                <span class="row-value mono">{{ formatSpan(libraryTotals.longest.duration) }}</span>
              </div>
            </div>
          </UCard>

          <!-- ----------------------------------------------------- activity -->
          <UCard class="panel">
            <template #header>
              <h2 class="panel-title">Recording activity</h2>
              <p class="panel-sub">Clips recorded per month over the last year.</p>
            </template>

            <ul class="months" aria-label="Clips recorded per month">
              <li v-for="m in monthlyActivity" :key="m.key" class="month" :title="`${m.title}: ${m.count} clips`">
                <span class="month-track">
                  <span class="month-fill" :class="{ 'is-empty': !m.count }" :style="bar(m.share)" />
                </span>
                <span class="month-count mono">{{ m.count }}</span>
                <span class="month-label">{{ m.label }}</span>
                <span class="sr-only">{{ m.title }}: {{ m.count }} clips, {{ formatBytes(m.bytes) }}</span>
              </li>
            </ul>
          </UCard>

          <!-- -------------------------------------------------------- games -->
          <UCard class="panel">
            <template #header>
              <h2 class="panel-title">Biggest games</h2>
              <p class="panel-sub">Where your disk space actually goes.</p>
            </template>

            <ul class="bars" aria-label="Games by disk space">
              <li v-for="g in topGames" :key="g.key" class="bar-row">
                <span class="bar-label truncate" :title="g.label">{{ g.label }}</span>
                <span class="bar-track">
                  <span class="bar-fill" :style="bar(g.share)" />
                </span>
                <span class="bar-value mono">{{ formatBytes(g.bytes) }}</span>
                <span class="bar-sub mono">{{ g.count }}</span>
              </li>
            </ul>
          </UCard>

          <!-- ------------------------------------------------------ formats -->
          <UCard class="panel">
            <template #header>
              <h2 class="panel-title">Formats</h2>
              <p class="panel-sub">Resolutions and video codecs found across the library.</p>
            </template>

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
            </div>
          </UCard>
        </template>

        <UEmpty
          v-else
          class="panel empty"
          icon="i-lucide-chart-column"
          title="Nothing to measure yet"
          description="Add a folder of recordings and the library numbers will fill in as it scans."
          variant="subtle"
          :actions="[
            { label: 'Library & settings', icon: 'i-lucide-sliders-horizontal', onClick: goSettings }
          ]"
        />

        <!-- ---------------------------------------------------------- app -->
        <UCard v-if="appStats" class="panel" :ui="{ body: 'p-0 sm:p-0' }">
          <template #header>
            <h2 class="panel-title">App</h2>
            <p class="panel-sub">This build and what it is currently using.</p>
          </template>

          <div class="rows">
            <div class="row">
              <span class="row-icon"><Icon name="package" :size="18" /></span>
              <div class="row-text">
                <span class="row-title">Sift {{ appStats.runtime.appVersion }}</span>
                <p class="row-desc">
                  Electron {{ appStats.runtime.electron }} · Chromium {{ appStats.runtime.chrome }} · Node
                  {{ appStats.runtime.node }}
                </p>
              </div>
              <UBadge color="neutral" variant="subtle" size="sm" :label="appStats.runtime.platform" class="mono" />
            </div>

            <div class="row">
              <span class="row-icon"><Icon name="memory" :size="18" /></span>
              <div class="row-text">
                <span class="row-title">Memory in use</span>
                <p class="row-desc">
                  Working set across {{ appStats.runtime.processCount }} process{{
                    appStats.runtime.processCount === 1 ? '' : 'es'
                  }}.
                </p>
              </div>
              <span class="row-value mono">{{ formatBytes(appStats.runtime.memoryBytes) }}</span>
            </div>

            <div class="row">
              <span class="row-icon"><Icon name="activity" :size="18" /></span>
              <div class="row-text">
                <span class="row-title">Running for</span>
                <p class="row-desc">{{ measuredLabel }}</p>
              </div>
              <span class="row-value mono">{{ formatSpan(appStats.runtime.uptimeMs / 1000) }}</span>
            </div>

            <div class="row">
              <span class="row-icon" :class="{ 'is-warning': !appStats.runtime.ffmpeg }">
                <Icon :name="appStats.runtime.ffmpeg ? 'zap' : 'alert'" :size="18" />
              </span>
              <div class="row-text">
                <span class="row-title">Bundled ffmpeg</span>
                <p class="row-desc">
                  {{
                    appStats.runtime.ffmpeg
                      ? 'Probing and preview generation are available.'
                      : 'Not found — durations and previews cannot be generated.'
                  }}
                </p>
              </div>
              <UBadge
                :color="appStats.runtime.ffmpeg ? 'primary' : 'warning'"
                variant="subtle"
                size="sm"
                :label="appStats.runtime.ffmpeg ? 'Ready' : 'Missing'"
              />
            </div>
          </div>
        </UCard>

        <p class="about">Measured locally. Nothing on this screen leaves your PC.</p>
      </div>
    </div>
  </section>
</template>

<style scoped>
.view {
  flex: 1;
  min-height: 0;
  display: flex;
}
.scroll {
  flex: 1;
  overflow-y: auto;
}
.page {
  max-width: var(--page-max);
  margin: 0 auto;
  padding: var(--s-6) 28px var(--s-10);
}
.head {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: var(--s-4);
  margin-bottom: var(--s-6);
}
.head h1 {
  font-size: var(--text-2xl);
  font-weight: 700;
}
.sub {
  margin-top: var(--s-1);
  font-size: var(--text-sm);
  color: var(--fg-muted);
}

/* Headline figures: four equal tiles that drop to two columns when narrow. */
.tiles {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
  gap: var(--s-3);
  list-style: none;
  margin: 0 0 var(--s-5);
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

.notice {
  margin-bottom: var(--s-5);
}

/* A panel is one titled card: header, then hairline-separated rows. */
.panel + .panel {
  margin-top: var(--s-5);
}
.panel-title {
  font-size: var(--text-md);
  font-weight: 600;
}
.panel-sub {
  margin-top: var(--s-1);
  font-size: var(--text-sm);
  color: var(--fg-muted);
}
.panel-alert {
  margin: var(--s-5) var(--s-6);
}
.empty {
  padding: var(--s-8) var(--s-6);
}
.rows {
  list-style: none;
  margin: 0;
  padding: 0;
}
.row {
  display: flex;
  align-items: center;
  gap: var(--s-3);
  /* Horizontal padding matches the card header so labels line up down the panel. */
  padding: var(--s-4) var(--s-6);
}
.row + .row {
  border-top: 1px solid var(--border);
}
.row-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  flex: 0 0 auto;
  border-radius: var(--r-md);
  background: var(--bg-3);
  color: var(--secondary);
}
.row-icon.is-warning {
  background: rgba(251, 191, 36, 0.14);
  color: var(--warning);
}
.row-text {
  flex: 1;
  min-width: 0;
  margin-right: var(--s-2);
}
.row-title {
  font-weight: 600;
  font-size: var(--text-md);
}
.row-desc {
  margin-top: 2px;
  font-size: var(--text-sm);
  color: var(--fg-muted);
  line-height: 1.45;
}
.row-progress {
  margin-top: var(--s-2);
  max-width: 320px;
}
.row-value {
  flex: 0 0 auto;
  font-size: var(--text-md);
  font-weight: 600;
  color: var(--fg);
}
.row-action {
  margin-left: var(--s-1);
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
  color: var(--fg-dim);
}

/* Horizontal ranking bars. */
.bars {
  list-style: none;
  margin: 0;
  padding: 0;
}
.bar-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 2.2fr auto 44px;
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
  color: var(--fg-dim);
  text-align: right;
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
  color: var(--fg-dim);
}
.chip-list {
  display: flex;
  flex-wrap: wrap;
  gap: var(--s-2);
}

.about {
  margin-top: var(--s-6);
  font-size: var(--text-xs);
  color: var(--fg-dim);
}
</style>
