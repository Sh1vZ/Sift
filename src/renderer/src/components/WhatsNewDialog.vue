<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import {
  changelog,
  changelogLoading,
  dismissWhatsNew,
  loadChangelog,
  whatsNew,
} from '@/composables/useUpdates'
import ChangelogBlocks from './changelog/ChangelogBlocks.vue'

/**
 * Shown once, the first time a build runs after Sift has updated itself. The
 * notes come from the CHANGELOG.md bundled with the app rather than the update
 * feed — by the time a version is running there is nothing left to fetch — and
 * arrive as parsed blocks, so nothing here renders markup.
 *
 * Dismissing is what records the version as seen, so notes the user never got to
 * are offered again next launch instead of being silently consumed.
 */
const open = computed({
  get: () => whatsNew.value !== null,
  set: (v: boolean) => {
    if (!v) dismissWhatsNew()
  },
})

type View = 'version' | 'all'

const VIEWS: { value: View; label: string; icon: string }[] = [
  { value: 'version', label: 'This version', icon: 'i-lucide-sparkles' },
  { value: 'all', label: 'Full changelog', icon: 'i-lucide-history' },
]

const view = ref<View>('version')

/** The whole file is only read when someone actually asks for the history. */
function show(next: View): void {
  view.value = next
  if (next === 'all') void loadChangelog()
}

const releases = computed(() => changelog.value ?? [])
const historyEmpty = computed(
  () => !changelogLoading.value && changelog.value !== null && releases.value.length === 0,
)

const title = computed(() =>
  view.value === 'version' ? `What's new in Sift ${whatsNew.value?.version ?? ''}` : 'Changelog',
)
const description = computed(() =>
  view.value === 'version'
    ? 'Sift updated itself since you last used it.'
    : 'Every release, newest first.',
)

/** `2026-09-03` -> `3 Sep 2026`, parsed as a local date so it cannot slip a day. */
function releaseDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  if (!m) return ''
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

/**
 * Edge fades tell the user there is more to read. They are driven from scroll
 * position rather than always painted, so a section that fits shows no false
 * "there is more below" hint.
 */
const scroller = ref<HTMLElement | null>(null)
const atTop = ref(true)
const atBottom = ref(true)

function sync(): void {
  const el = scroller.value
  if (!el) return
  atTop.value = el.scrollTop <= 1
  atBottom.value = el.scrollTop + el.clientHeight >= el.scrollHeight - 1
}

// The scroller only exists while the modal is open, and its content changes with
// the tab and with the history arriving; re-measure after each.
watch([scroller, view, changelog, changelogLoading], () => void nextTick(sync))
</script>

<template>
  <UModal
    v-model:open="open"
    :title="title"
    :description="description"
    :ui="{
      content: 'max-w-xl',
      header: 'pe-12 sm:pe-12',
      title: 'font-heading text-base',
      body: 'p-0 sm:p-0',
    }"
  >
    <template #body>
      <div class="tabs">
        <UFieldGroup size="xs" aria-label="Changelog view">
          <UButton
            v-for="v in VIEWS"
            :key="v.value"
            :icon="v.icon"
            :label="v.label"
            :color="view === v.value ? 'primary' : 'neutral'"
            :variant="view === v.value ? 'soft' : 'subtle'"
            :aria-pressed="view === v.value"
            @click="show(v.value)"
          />
        </UFieldGroup>
      </div>

      <div class="viewport" :class="{ 'fade-top': !atTop, 'fade-bottom': !atBottom }">
        <div ref="scroller" class="scroll" @scroll.passive="sync">
          <ChangelogBlocks v-if="view === 'version'" :blocks="whatsNew?.blocks ?? []" />

          <div v-else-if="changelogLoading" class="loading">
            <USkeleton
              v-for="n in 6"
              :key="n"
              class="h-4"
              :class="n % 3 === 0 ? 'w-2/3' : 'w-full'"
            />
          </div>

          <UEmpty
            v-else-if="historyEmpty"
            icon="i-lucide-file-question"
            title="No changelog bundled"
            description="This build shipped without its CHANGELOG.md. The release notes are on GitHub."
          />

          <div v-else class="history">
            <section v-for="release in releases" :key="release.version" class="release">
              <header class="release-head">
                <h3 class="version mono">{{ release.version }}</h3>
                <UBadge
                  v-if="release.version === whatsNew?.version"
                  size="sm"
                  color="primary"
                  variant="soft"
                  label="Installed"
                />
                <span v-if="release.date" class="date">{{ releaseDate(release.date) }}</span>
              </header>
              <ChangelogBlocks :blocks="release.blocks" />
            </section>
          </div>
        </div>
      </div>
    </template>
    <template #footer>
      <UButton class="ms-auto shrink-0" label="Got it" color="primary" @click="dismissWhatsNew()" />
    </template>
  </UModal>
</template>

<style scoped>
.tabs {
  display: flex;
  padding: var(--s-3) var(--s-4);
  border-bottom: 1px solid var(--border);
}

/* The fades sit over the scroller, so the scrollbar stays clear of them. */
.viewport {
  position: relative;
}

.viewport::before,
.viewport::after {
  content: '';
  position: absolute;
  left: 0;
  right: 0;
  height: var(--s-6);
  pointer-events: none;
  opacity: 0;
  transition: opacity var(--dur-fast) var(--ease-out);
  z-index: 1;
}

.viewport::before {
  top: 0;
  background: linear-gradient(to bottom, var(--bg-1), transparent);
}

.viewport::after {
  bottom: 0;
  background: linear-gradient(to top, var(--bg-1), transparent);
}

.viewport.fade-top::before,
.viewport.fade-bottom::after {
  opacity: 1;
}

.scroll {
  max-height: min(52vh, 460px);
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: var(--s-4);
}

.loading {
  display: flex;
  flex-direction: column;
  gap: var(--s-3);
}

.history {
  display: flex;
  flex-direction: column;
  gap: var(--s-6);
}

.release-head {
  display: flex;
  align-items: center;
  gap: var(--s-2);
  margin-bottom: var(--s-3);
  padding-bottom: var(--s-2);
  border-bottom: 1px solid var(--border);
}

.version {
  margin: 0;
  font-size: var(--text-base);
  font-weight: 600;
  color: var(--fg);
}

.date {
  margin-left: auto;
  font-size: var(--text-xs);
  color: var(--fg-dim);
}
</style>
