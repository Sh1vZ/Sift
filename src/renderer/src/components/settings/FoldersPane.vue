<script setup lang="ts">
import { computed, ref } from 'vue'
import type { Clip, LibraryFolder } from '@shared/types'
import DropWash from '../DropWash.vue'
import SettingsPanel from './SettingsPanel.vue'
import SettingsRow from './SettingsRow.vue'
import {
  addFolder,
  folders,
  recordings,
  removeFolder,
  rescan,
  scan,
} from '@/composables/useLibrary'
import { useFolderDrop } from '@/composables/useDropFolders'
import { confirm } from '@/composables/useDialogs'

/** The clips folder has its own pane; this list is the recording roots only. */
const libraryFolders = computed(() => folders.value.filter((f) => f.kind === 'library'))
const withThumbs = computed(() => recordings.value.filter((c) => c.thumb).length)

interface Counts {
  videos: number
  images: number
}

/** Recordings and screenshots tallied apart, for the summary and each folder's badge. */
function countsOf(clips: Clip[]): Counts {
  const n: Counts = { videos: 0, images: 0 }
  for (const c of clips) {
    if (c.kind === 'image') n.images++
    else n.videos++
  }
  return n
}

/** "40 clips · 7 screenshots", or just the clips where there are no stills. */
function countLabel(c: Counts): string {
  const clips = `${c.videos} clip${c.videos === 1 ? '' : 's'}`
  return c.images ? `${clips} · ${c.images} screenshot${c.images === 1 ? '' : 's'}` : clips
}

const summary = computed(() => {
  const f = libraryFolders.value.length
  return `${countLabel(countsOf(recordings.value))} indexed across ${f} folder${f === 1 ? '' : 's'} · ${withThumbs.value} with previews. Drop a folder here to add it.`
})

/** Each folder's own tally, live from the index rather than the count its last scan wrote. */
const folderCounts = computed(() => {
  const map = new Map<string, Clip[]>()
  for (const c of recordings.value) {
    const list = map.get(c.folderId)
    if (list) list.push(c)
    else map.set(c.folderId, [c])
  }
  return new Map([...map].map(([id, clips]) => [id, countsOf(clips)]))
})
const folderLabel = (f: LibraryFolder): string =>
  countLabel(folderCounts.value.get(f.id) ?? { videos: f.clipCount, images: 0 })

/** Folders whose removal is still stopping watchers and dropping clips; their button spins. */
const removing = ref<string[]>([])

// The whole panel body takes a dropped folder.
const zone = ref<HTMLElement | null>(null)
const { dropping } = useFolderDrop(zone)

async function remove(folder: LibraryFolder): Promise<void> {
  const ok = await confirm({
    title: 'Remove this folder?',
    message: 'Its clips leave the library. Nothing on disk is renamed, moved or deleted.',
    detail: folder.path,
    detailIcon: 'i-lucide-folder',
    confirmLabel: 'Remove',
    danger: true,
  })
  if (!ok) return
  removing.value = [...removing.value, folder.id]
  try {
    await removeFolder(folder)
  } finally {
    removing.value = removing.value.filter((id) => id !== folder.id)
  }
}
</script>

<template>
  <div class="stack">
    <SettingsPanel title="Watched folders" :description="summary" flush>
      <template #actions>
        <UButton
          icon="i-lucide-folder-plus"
          label="Add folder"
          color="primary"
          @click="addFolder()"
        />
      </template>

      <div ref="zone" class="slot">
        <Transition name="dissolve">
          <UEmpty
            v-if="!libraryFolders.length"
            key="empty"
            class="panel-empty"
            icon="i-lucide-folder"
            title="No folders yet"
            description="Add the one ShadowPlay records to — usually your Videos folder — or drop it here."
            variant="subtle"
            size="sm"
            :actions="[
              { label: 'Add folder', icon: 'i-lucide-folder-plus', onClick: () => addFolder() },
            ]"
          />
          <ul v-else key="rows" class="rows">
            <SettingsRow
              v-for="f in libraryFolders"
              :id="f === libraryFolders[0] ? 'folders' : ''"
              :key="f.id"
              tag="li"
              :icon="f.available ? 'hard-drive' : 'alert'"
              :tone="f.available ? 'default' : 'warning'"
              :title="f.name"
              :description="
                f.available
                  ? ''
                  : 'Not reachable right now. Its clips stay in the library and play again once the drive is back.'
              "
              :path="f.path"
            >
              <template #badges>
                <UBadge
                  v-if="!f.available"
                  color="warning"
                  variant="subtle"
                  label="Not reachable"
                />
                <UBadge
                  v-else-if="scan.active && scan.folder === f.name"
                  color="primary"
                  variant="subtle"
                  icon="i-lucide-loader-circle"
                  label="Scanning"
                  :ui="{ leadingIcon: 'animate-spin' }"
                />
              </template>

              <template #trailing>
                <UBadge color="neutral" variant="soft" :label="folderLabel(f)" class="mono count" />
                <UButton
                  icon="i-lucide-refresh-cw"
                  label="Rescan"
                  color="neutral"
                  variant="subtle"
                  size="sm"
                  :disabled="!f.available || scan.active"
                  @click="rescan(f.id)"
                />
                <!-- Held off the button beside it, so it is never a mis-click. -->
                <UButton
                  class="danger"
                  icon="i-lucide-trash-2"
                  label="Remove"
                  color="error"
                  variant="subtle"
                  size="sm"
                  :loading="removing.includes(f.id)"
                  :disabled="removing.includes(f.id)"
                  @click="remove(f)"
                />
              </template>
            </SettingsRow>
          </ul>
        </Transition>
        <Transition name="fade">
          <DropWash v-if="dropping" />
        </Transition>
      </div>
    </SettingsPanel>

    <SettingsPanel
      title="Rescan"
      description="For when something was missed: a full walk of every reachable folder."
      flush
    >
      <SettingsRow
        id="rescan"
        icon="radar"
        title="Rescan all folders"
        description="Walks every reachable folder again and picks up anything the watcher missed."
      >
        <template #trailing>
          <UButton
            icon="i-lucide-refresh-cw"
            label="Rescan"
            color="neutral"
            variant="subtle"
            :disabled="!libraryFolders.length || scan.active"
            :loading="scan.active"
            @click="rescan()"
          />
        </template>
      </SettingsRow>
    </SettingsPanel>
  </div>
</template>

<style scoped>
/* Holds the box the list and the empty state animate inside; without it the
   leaving one, which goes absolute mid-transition, would anchor to the window. */
.slot {
  position: relative;
}
.rows {
  list-style: none;
  margin: 0;
  padding: 0;
}
.panel-empty {
  padding: var(--s-6);
}
.count {
  margin-right: var(--s-1);
}
.danger {
  margin-left: var(--s-2);
}
</style>
