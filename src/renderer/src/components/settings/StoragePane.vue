<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import type { Clip } from '@shared/types'
import Icon from '../Icon.vue'
import SettingsPanel from './SettingsPanel.vue'
import SettingsRow from './SettingsRow.vue'
import {
  goClips,
  now,
  openGame,
  revealClip,
  scopeOf,
  updateSettings,
} from '@/composables/useLibrary'
import { openClip } from '@/composables/usePlayer'
import {
  appStats,
  biggestClips,
  cleanupBytes,
  cleanupHints,
  clearPreviews,
  drives,
  libraryTotals,
  oldestClip,
  refreshStats,
  revealAppData,
  statsError,
  statsLoading,
  type CleanupHint,
  type DriveSegment,
  type DriveUsage,
} from '@/composables/useStats'
import { formatBytes, formatDuration, formatFull, formatRelative } from '@/utils/format'
import { formatBitrate } from '@/utils/quality'

const api = window.api
const n = new Intl.NumberFormat()

/** Everything Sift itself keeps under the app-data folder. */
const appDataBytes = computed(() => {
  const s = appStats.value?.storage
  if (!s) return 0
  return s.databaseBytes + s.cacheBytes + s.otherBytes
})

const measuredLabel = computed(() =>
  appStats.value
    ? `Measured ${formatRelative(appStats.value.generatedAtMs, now.value).toLowerCase()}`
    : 'Measuring…',
)

const clearing = ref(false)
async function onClearPreviews(): Promise<void> {
  clearing.value = true
  try {
    await clearPreviews()
  } finally {
    clearing.value = false
  }
}

// -------------------------------------------------------------------- drives

/** What Sift costs this drive, in the drive's own terms. */
const drivePct = (d: DriveUsage): string =>
  !d.totalBytes || !d.siftPct ? '' : d.siftPct < 1 ? 'under 1%' : `${Math.round(d.siftPct)}%`

function driveSummary(d: DriveUsage): string {
  const parts: string[] = []
  const folders = d.folders.filter((f) => f.kind === 'library').length
  if (folders) parts.push(`${folders} watched folder${folders === 1 ? '' : 's'}`)
  if (d.folders.some((f) => f.kind === 'clips')) parts.push('the clips folder')
  parts.push(`${n.format(d.clips)} file${d.clips === 1 ? '' : 's'}`)
  const pct = drivePct(d)
  if (pct) parts.push(`${pct} of the drive`)
  return `${parts.join(' · ')}.`
}

/**
 * The brand ramp the folder slices are drawn from. The heaviest folder keeps
 * --primary, so a drive still reads as "Sift purple" at a glance, and the ends
 * of the ramp are far enough apart that two folders never look alike.
 */
const RAMP = ['var(--primary)', 'var(--secondary)', 'var(--accent)']

/** Colour for slice `i` of `n`, walking the ramp evenly. */
function segColor(i: number, n: number): string {
  if (n <= 1 || i <= 0) return RAMP[0]
  const t = (i / (n - 1)) * (RAMP.length - 1)
  const from = Math.min(Math.floor(t), RAMP.length - 2)
  const mix = Math.round((t - from) * 100)
  if (!mix) return RAMP[from]
  return `color-mix(in oklab, ${RAMP[from + 1]} ${mix}%, ${RAMP[from]})`
}

/** A hairline of a slice is still a slice, so tiny folders keep 3px of bar. */
const segWidth = (pct: number): string => `max(3px, ${pct}%)`

/** The legend swatch: the drive's own slices, side by side. */
const siftGradient = (d: DriveUsage): string => {
  const stops = d.segments.map((_, i) => segColor(i, d.segments.length))
  if (stops.length < 2) return stops[0] ?? RAMP[0]
  return `linear-gradient(90deg, ${stops.join(', ')})`
}

const segLabel = (s: DriveSegment): string =>
  s.kind === 'appdata' ? 'App data' : s.kind === 'other' ? 'Other files' : s.path

const meterLabel = (d: DriveUsage): string => {
  const parts = d.segments.map((s) => `${segLabel(s)} ${formatBytes(s.bytes)}`)
  return `${d.root} is ${d.usedPct}% full; Sift accounts for ${formatBytes(d.siftBytes)} of that${
    parts.length ? ` — ${parts.join(', ')}` : ''
  }.`
}

// ------------------------------------------------------------ biggest clips

interface ClipRow {
  clip: Clip
  /** Position in the size ranking; '' for the oldest row, which shows an icon. */
  rank: string
  icon: string
  label: string
}

const clipRows = computed<ClipRow[]>(() => {
  const rows: ClipRow[] = biggestClips.value.map((clip, i) => ({
    clip,
    rank: String(i + 1),
    icon: '',
    label: '',
  }))
  const oldest = oldestClip.value
  if (oldest) rows.push({ clip: oldest, rank: '', icon: 'calendar', label: 'Oldest' })
  return rows
})

const poster = (c: Clip): string => (c.thumb ? api.thumbUrl(c.thumb) : '')

const clipMeta = (c: Clip): string =>
  [c.game, formatFull(c.recordedAtMs), c.duration ? formatDuration(c.duration) : '']
    .filter(Boolean)
    .join(' · ')

/** Opens the file in the player, over the settings screen. */
const play = (c: Clip): void => openClip(c, null, scopeOf(c))

// ------------------------------------------------------------------ cleanup

const cleanupDescription = computed(() =>
  cleanupHints.value.length
    ? `Suggestions only — nothing here deletes anything. Between them these could free up to ${formatBytes(cleanupBytes.value)}.`
    : 'Sift looks for games you have put down, year-old pile-ups, and recordings kept beside their own trims.',
)

/** Hands the user to the grid holding the footage, where the delete actions live. */
function review(hint: CleanupHint): void {
  if (hint.kind === 'duplicate') {
    goClips()
    return
  }
  // Old footage sits at the bottom of a newest-first grid; put it on top so the
  // review starts on the clips the row is actually about.
  if (hint.kind === 'old-footage') void updateSettings({ sort: 'oldest' })
  openGame(hint.game)
}

// Walking the app-data folder is on-demand, so only measure if nothing is cached.
onMounted(() => {
  if (!appStats.value) void refreshStats()
})
</script>

<template>
  <div class="stack">
    <SettingsPanel title="On disk" :description="measuredLabel" flush>
      <template #actions>
        <UButton
          icon="i-lucide-refresh-cw"
          label="Refresh"
          color="neutral"
          variant="subtle"
          :loading="statsLoading"
          @click="refreshStats()"
        />
      </template>

      <div class="slot">
        <Transition name="dissolve">
          <UAlert
            v-if="statsError"
            key="error"
            class="panel-alert"
            color="warning"
            variant="subtle"
            icon="i-lucide-triangle-alert"
            title="Could not measure the app data folder"
            :description="statsError"
            :actions="[
              {
                label: 'Try again',
                color: 'neutral',
                variant: 'subtle',
                onClick: () => refreshStats(),
              },
            ]"
          />
          <div v-else-if="!appStats" key="loading" class="skeletons">
            <div v-for="i in 4" :key="i" class="skeleton-row">
              <USkeleton class="size-9 rounded-lg" />
              <div class="skeleton-text">
                <USkeleton class="h-4 w-40" />
                <USkeleton class="mt-2 h-3 w-64" />
              </div>
              <USkeleton class="h-5 w-16" />
            </div>
          </div>
          <div v-else key="rows">
            <SettingsRow
              id="storage-recordings"
              icon="film"
              title="Recordings on disk"
              :description="`Across ${libraryTotals.folders} watched folder${libraryTotals.folders === 1 ? '' : 's'}. Indexed in place — never copied, moved or re-encoded.`"
              :value="formatBytes(libraryTotals.bytes)"
            />

            <SettingsRow
              v-if="libraryTotals.avgBitrate"
              id="storage-bitrate"
              icon="activity"
              title="Average bitrate"
              description="Size against duration across every probed clip. A high figure means a generous capture setting — it is what makes the library big, not what makes a clip look good."
              :value="formatBitrate(libraryTotals.avgBitrate)"
            />

            <SettingsRow
              id="storage-previews"
              icon="image"
              title="Preview cache"
              :description="`${n.format(appStats.storage.cacheFiles)} poster frames, hover-scrub strips, filmstrips and HDR screenshot renders, generated once and reused. GIF previews go after an hour and extracted audio tracks after a week unused; Clear previews takes all of it at once.`"
              :value="formatBytes(appStats.storage.cacheBytes)"
            >
              <template #trailing>
                <UButton
                  icon="i-lucide-eraser"
                  label="Clear previews"
                  color="neutral"
                  variant="subtle"
                  size="sm"
                  :disabled="!appStats.storage.cacheFiles"
                  :loading="clearing"
                  @click="onClearPreviews()"
                />
              </template>
            </SettingsRow>

            <SettingsRow
              id="storage-database"
              icon="database"
              title="Index database"
              :description="`SQLite record of ${n.format(libraryTotals.clips)} clip${libraryTotals.clips === 1 ? '' : 's'}, including the write-ahead log.`"
              :value="formatBytes(appStats.storage.databaseBytes)"
            />

            <SettingsRow
              id="storage-appdata"
              icon="box"
              title="App data"
              :path="appStats.storage.userDataPath"
              :value="formatBytes(appDataBytes)"
            >
              <template #trailing>
                <UButton
                  icon="i-lucide-folder-open"
                  label="Open folder"
                  color="neutral"
                  variant="subtle"
                  size="sm"
                  aria-label="Open the app data folder"
                  @click="revealAppData()"
                />
              </template>
            </SettingsRow>
          </div>
        </Transition>
      </div>
    </SettingsPanel>

    <SettingsPanel
      v-if="!statsError"
      title="Drives"
      description="Every drive your folders live on, and how much of each one is Sift's doing."
      flush
    >
      <div class="slot">
        <Transition name="dissolve">
          <div v-if="!appStats" key="loading" class="skeletons">
            <div v-for="i in 2" :key="i" class="skeleton-row">
              <USkeleton class="size-9 rounded-lg" />
              <div class="skeleton-text">
                <USkeleton class="h-4 w-24" />
                <USkeleton class="mt-2 h-3 w-56" />
              </div>
              <USkeleton class="h-5 w-16" />
            </div>
          </div>
          <div v-else-if="drives.length" key="rows">
            <SettingsRow
              v-for="d in drives"
              :key="d.root"
              icon="hard-drive"
              :title="d.root"
              :description="driveSummary(d)"
              :value="formatBytes(d.siftBytes)"
            >
              <template #badges>
                <UBadge
                  v-if="d.appDataBytes"
                  color="neutral"
                  variant="subtle"
                  size="sm"
                  label="App data"
                />
              </template>

              <template v-if="d.totalBytes">
                <span class="meter" role="img" :aria-label="meterLabel(d)">
                  <span
                    v-for="(s, i) in d.segments"
                    :key="s.id"
                    class="meter-seg"
                    :style="{
                      width: segWidth(s.pct),
                      background: segColor(i, d.segments.length),
                    }"
                  />
                  <span
                    class="meter-seg meter-other"
                    :style="{ width: `${Math.max(0, d.usedPct - d.siftPct)}%` }"
                  />
                </span>
                <p class="legend">
                  <span class="legend-item">
                    <span class="swatch" :style="{ background: siftGradient(d) }" />Sift
                    {{ formatBytes(d.siftBytes) }}
                  </span>
                  <span class="legend-item">
                    <span class="swatch swatch-other" />Everything else
                    {{ formatBytes(Math.max(0, d.totalBytes - d.freeBytes - d.siftBytes)) }}
                  </span>
                  <span class="legend-item">
                    <span class="swatch swatch-free" />{{ formatBytes(d.freeBytes) }} free of
                    {{ formatBytes(d.totalBytes) }}
                  </span>
                </p>
              </template>
              <p v-else class="legend">This drive would not report its free space.</p>

              <ul v-if="d.segments.length" class="folders">
                <li v-for="(s, i) in d.segments" :key="s.id" class="folder">
                  <span
                    class="swatch"
                    :style="{ background: segColor(i, d.segments.length) }"
                    aria-hidden="true"
                  />
                  <span class="folder-path truncate" :title="s.path">{{ segLabel(s) }}</span>
                  <span class="folder-note">
                    <template v-if="!s.available">not reachable right now</template>
                    <template v-else-if="s.kind === 'appdata'">cache, index and settings</template>
                    <template v-else-if="s.clips">
                      {{ n.format(s.clips) }} file{{ s.clips === 1 ? '' : 's' }}
                    </template>
                  </span>
                  <span class="folder-size mono">{{ formatBytes(s.bytes) }}</span>
                </li>
              </ul>
              <ul v-else-if="d.folders.length" class="folders">
                <li v-for="f in d.folders" :key="f.id" class="folder">
                  <span class="folder-path truncate" :title="f.path">{{ f.path }}</span>
                  <span class="folder-note">
                    {{ f.available ? 'nothing indexed here' : 'not reachable right now' }}
                  </span>
                </li>
              </ul>
            </SettingsRow>
          </div>
          <UEmpty
            v-else
            key="empty"
            class="empty"
            icon="i-lucide-hard-drive"
            title="No drives to measure"
            description="Add a folder of recordings and the drive it sits on shows up here."
            variant="subtle"
          />
        </Transition>
      </div>
    </SettingsPanel>

    <SettingsPanel
      v-if="clipRows.length"
      title="Biggest and oldest"
      description="The heaviest files in the index, and the one that has been sitting there longest. Click any of them to play it."
      flush
    >
      <ul class="clips">
        <li v-for="row in clipRows" :key="`${row.label}:${row.clip.id}`" class="clip-row">
          <button type="button" class="clip-main" @click="play(row.clip)">
            <span class="clip-rank mono">
              <Icon v-if="row.icon" :name="row.icon" :size="14" />
              <template v-else>{{ row.rank }}</template>
            </span>
            <span class="clip-thumb">
              <img v-if="poster(row.clip)" :src="poster(row.clip)" alt="" loading="lazy" />
              <Icon v-else name="film" :size="16" />
            </span>
            <span class="clip-text">
              <span class="clip-title-line">
                <span class="clip-title truncate">{{ row.clip.title }}</span>
                <UBadge
                  v-if="row.label"
                  color="neutral"
                  variant="subtle"
                  size="sm"
                  :label="row.label"
                />
              </span>
              <span class="clip-meta truncate">{{ clipMeta(row.clip) }}</span>
            </span>
            <span class="clip-size mono">{{ formatBytes(row.clip.size) }}</span>
          </button>
          <UButton
            icon="i-lucide-folder-open"
            color="neutral"
            variant="ghost"
            size="sm"
            square
            :aria-label="`Show ${row.clip.title} in the file manager`"
            @click="revealClip(row.clip)"
          />
        </li>
      </ul>
    </SettingsPanel>

    <SettingsPanel
      v-if="libraryTotals.clips"
      title="Worth clearing out"
      :description="cleanupDescription"
      flush
    >
      <SettingsRow
        v-for="hint in cleanupHints"
        :key="hint.id"
        :icon="hint.icon"
        :title="hint.title"
        :description="hint.detail"
        :value="formatBytes(hint.bytes)"
      >
        <template #trailing>
          <UButton
            label="Review"
            trailing-icon="i-lucide-arrow-right"
            color="neutral"
            variant="subtle"
            size="sm"
            @click="review(hint)"
          />
        </template>
      </SettingsRow>

      <SettingsRow
        v-if="!cleanupHints.length"
        icon="check"
        title="Nothing obvious to clear out"
        description="No dormant games, no year-old pile-ups, and no recordings left sitting beside their own trims."
      />
    </SettingsPanel>

    <p class="about">Measured locally. Nothing on this screen leaves your PC.</p>
  </div>
</template>

<style scoped>
/* Holds the box the skeletons and the loaded rows animate inside. */
.slot {
  position: relative;
}
.panel-alert {
  margin: var(--s-5) var(--s-6);
}
.skeletons {
  padding: var(--s-2) 0;
}
.skeleton-row {
  display: flex;
  align-items: center;
  gap: var(--s-3);
  padding: var(--s-4) var(--s-6);
}
.skeleton-text {
  flex: 1;
  min-width: 0;
}
.empty {
  padding: var(--s-8) var(--s-6);
}

/* Drive meter: how full the volume is, with Sift's share drawn over it. One
   slice per folder first, then everything else on the drive; what is left of
   the track is free space. The hairline gaps keep neighbouring slices apart. */
.meter {
  display: flex;
  gap: 1px;
  height: 10px;
  max-width: 420px;
  margin-top: var(--s-3);
  border-radius: var(--r-full);
  background: var(--bg-2);
  overflow: hidden;
}
.meter-seg {
  flex: 0 0 auto;
  min-width: 0;
  transition: width var(--dur) var(--ease-out);
}
.meter-other {
  background: var(--bg-4);
}
.legend {
  display: flex;
  flex-wrap: wrap;
  gap: var(--s-1) var(--s-4);
  margin-top: var(--s-2);
  font-size: var(--text-xs);
  color: var(--fg-muted);
}
.legend-item {
  display: inline-flex;
  align-items: center;
  gap: var(--s-2);
}
.swatch {
  width: 8px;
  height: 8px;
  flex: 0 0 auto;
  border-radius: 2px;
}
.swatch-other {
  background: var(--bg-4);
}
.swatch-free {
  background: var(--bg-2);
  border: 1px solid var(--border);
}
/* One line per meter slice, in the same order and the same colour, so the bar
   above can be read off the paths. */
.folders {
  list-style: none;
  margin: var(--s-2) 0 0;
  padding: 0;
  max-width: 560px;
}
.folder {
  display: flex;
  align-items: center;
  gap: var(--s-2);
  padding: 2px 0;
  font-size: var(--text-sm);
  color: var(--fg-dim);
  user-select: text;
}
.folder-path {
  flex: 0 1 auto;
  min-width: 0;
}
.folder-note {
  flex: 0 0 auto;
  font-size: var(--text-xs);
  color: var(--fg-muted);
  white-space: nowrap;
}
.folder-size {
  flex: 0 0 auto;
  margin-left: auto;
  color: var(--fg-muted);
  font-variant-numeric: tabular-nums;
}

/* Clip rows. The whole text block is the button so the row plays on a click;
   the reveal control is a sibling, because a button cannot nest in a button. */
.clips {
  list-style: none;
  margin: 0;
  padding: 0;
}
.clip-row {
  display: flex;
  align-items: center;
  gap: var(--s-2);
  padding-right: var(--s-5);
}
.clip-row + .clip-row {
  border-top: 1px solid var(--border);
}
.clip-main {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: var(--s-3);
  padding: var(--s-3) var(--s-2) var(--s-3) var(--s-6);
  background: none;
  border: 0;
  color: inherit;
  text-align: left;
  cursor: pointer;
  transition: background var(--dur-fast) var(--ease-out);
}
.clip-main:hover {
  background: var(--bg-4);
}
.clip-rank {
  flex: 0 0 auto;
  width: 16px;
  display: flex;
  justify-content: center;
  font-size: var(--text-sm);
  color: var(--fg-dim);
}
.clip-thumb {
  position: relative;
  flex: 0 0 auto;
  width: 64px;
  aspect-ratio: 16 / 9;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--r-sm);
  background: var(--bg-0);
  color: var(--fg-dim);
  overflow: hidden;
}
.clip-thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
.clip-text {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.clip-title-line {
  display: flex;
  align-items: center;
  gap: var(--s-2);
  min-width: 0;
}
.clip-title {
  font-size: var(--text-sm);
  font-weight: 600;
}
.clip-meta {
  font-size: var(--text-xs);
  color: var(--fg-muted);
}
.clip-size {
  flex: 0 0 auto;
  font-size: var(--text-sm);
  font-weight: 600;
}

.about {
  font-size: var(--text-xs);
  color: var(--fg-dim);
}
</style>
