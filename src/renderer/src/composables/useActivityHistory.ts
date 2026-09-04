import { ref } from 'vue'
import type { ActivityRecord, Clip } from '@shared/types'
import { youtubeUrl } from '@shared/youtube'
import { confirm } from './useDialogs'
import {
  copyClipFile,
  copyYouTubeLink,
  folders,
  games,
  getClip,
  openGame,
  rescan,
  revealClip,
} from './useLibrary'
import { openResult } from './useSearch'
import { openSettings } from './useSettings'
import { openUploadDialog } from './useUploads'
import { openExternalUrl } from './useYouTube'

const api = window.api

/**
 * The History tab of the Activity panel: what Sift finished, as main keeps
 * it. Main owns the rows (they outlive a reload and a restart); this is the
 * renderer's copy, replaced whole on every push.
 */
export const historyRecords = ref<ActivityRecord[]>([])

export function initActivityHistory(initial: ActivityRecord[]): void {
  historyRecords.value = initial
  api.on('activity:changed', (list) => (historyRecords.value = list))
}

// Both drop the rows locally first so the list answers the click; main's next
// push says the same thing a moment later.
export function removeActivity(id: string): void {
  historyRecords.value = historyRecords.value.filter((r) => r.id !== id)
  void api.activity.remove(id)
}

/** Confirmed first: one click would otherwise wipe up to 200 rows there is no way to get back. */
export async function clearActivity(): Promise<void> {
  const n = historyRecords.value.length
  if (!n) return
  const ok = await confirm({
    title: 'Clear the activity history?',
    message:
      'Every finished export, upload and clip change listed under History is forgotten. Nothing on disk or on YouTube is touched.',
    detail: `${n} ${n === 1 ? 'entry' : 'entries'}`,
    detailIcon: 'i-lucide-history',
    confirmLabel: 'Clear history',
    danger: true,
  })
  if (!ok) return
  historyRecords.value = []
  void api.activity.clear()
}

// ------------------------------------------------------------- presentation

/** The clip a row is about, if it is still in the index. */
export function historyClip(r: ActivityRecord): Clip | undefined {
  return r.clipId ? getClip(r.clipId) : undefined
}

/**
 * The row named a clip that has since left the library. Never true for a
 * delete (gone by design), a scan or a game rename, which name no clip.
 */
export function historyGone(r: ActivityRecord): boolean {
  return Boolean(r.clipId) && !getClip(r.clipId)
}

/** The past tense the second line opens with; failed rows say `<Verb> failed`. */
function verb(kind: ActivityRecord['kind']): string {
  // Every arm is spelled out: a `default` would let a new kind render with no verb.
  switch (kind) {
    case 'export':
      return 'Exported'
    case 'upload':
      return 'Uploaded'
    case 'copy-file':
      return 'File copied'
    case 'rename':
      return 'Renamed'
    case 'delete':
      return 'Deleted'
    case 'game-alias':
      return 'Game renamed'
    case 'scan':
      return 'Scanned'
  }
}

function failedVerb(kind: ActivityRecord['kind']): string {
  switch (kind) {
    case 'export':
      return 'Export failed'
    case 'upload':
      return 'Upload failed'
    case 'copy-file':
      return 'Copy failed'
    case 'rename':
      return 'Rename failed'
    case 'delete':
      return 'Delete failed'
    case 'game-alias':
      return 'Rename failed'
    case 'scan':
      return 'Scan failed'
  }
}

export function historyLine(r: ActivityRecord): string {
  if (r.status === 'failed') return r.error || failedVerb(r.kind)
  // Main already composed the whole sentence for these two.
  if (r.kind === 'game-alias' || r.kind === 'delete') return r.detail
  return r.detail ? `${verb(r.kind)} · ${r.detail}` : verb(r.kind)
}

export function historyIcon(r: ActivityRecord): string {
  switch (r.kind) {
    case 'export':
      return 'i-lucide-scissors'
    case 'upload':
      return 'i-lucide-youtube'
    case 'copy-file':
      return 'i-lucide-clipboard-copy'
    case 'rename':
      return 'i-lucide-pencil'
    case 'delete':
      return 'i-lucide-trash-2'
    case 'game-alias':
      return 'i-lucide-merge'
    case 'scan':
      return 'i-lucide-radar'
  }
}

// ------------------------------------------------------------------ actions

/** Where a click on the row goes; null when it goes nowhere (a deleted clip, a game since removed). */
function destination(r: ActivityRecord): (() => void) | null {
  switch (r.kind) {
    case 'export':
    case 'upload':
    case 'copy-file':
    case 'rename': {
      const clip = historyClip(r)
      return clip ? () => void openResult(clip) : null
    }
    case 'game-alias':
      return games.value.some((g) => g.name === r.game) ? () => openGame(r.game) : null
    case 'scan':
      return () => openSettings('folders')
    case 'delete':
      return null
  }
}

export function historyClickable(r: ActivityRecord): boolean {
  return destination(r) !== null
}

/** Follows the row. Returns true when it navigated, so the caller can close the panel. */
export function openHistoryRecord(r: ActivityRecord): boolean {
  const go = destination(r)
  if (!go) return false
  go()
  return true
}

export interface HistoryAction {
  label: string
  icon: string
  disabled?: boolean
  /** Leaves the panel behind (a dialog, another screen), so the panel closes on it. */
  navigates?: boolean
  onSelect: () => void
}

/** The buttons a row carries besides its remove. Clip-bound ones stay visible but disabled once the clip is gone. */
export function historyActions(r: ActivityRecord): HistoryAction[] {
  const clip = historyClip(r)
  const gone = !clip
  switch (r.kind) {
    case 'export':
      if (r.status === 'failed') return []
      return [
        {
          label: 'Show in Explorer',
          icon: 'i-lucide-folder-open',
          disabled: gone,
          onSelect: () => clip && revealClip(clip),
        },
      ]
    case 'upload':
      if (r.status === 'failed')
        return [
          {
            label: 'Upload again',
            icon: 'i-lucide-refresh-cw',
            disabled: gone,
            navigates: true,
            onSelect: () => clip && openUploadDialog(clip),
          },
        ]
      return [
        // Built from the recorded id, so it still works once the clip is gone.
        ...(r.videoId
          ? [
              {
                label: 'Open on YouTube',
                icon: 'i-lucide-external-link',
                onSelect: () => openExternalUrl(youtubeUrl(r.videoId)),
              },
            ]
          : []),
        {
          label: 'Copy link',
          icon: 'i-lucide-link',
          disabled: gone,
          onSelect: () => clip && void copyYouTubeLink(clip),
        },
      ]
    case 'copy-file':
      return [
        {
          label: 'Copy again',
          icon: 'i-lucide-clipboard-copy',
          disabled: gone,
          onSelect: () => clip && void copyClipFile(clip),
        },
      ]
    case 'rename':
      return [
        {
          label: 'Show in Explorer',
          icon: 'i-lucide-folder-open',
          disabled: gone,
          onSelect: () => clip && revealClip(clip),
        },
      ]
    case 'scan': {
      const folder = folders.value.find((f) => f.path === r.path)
      return folder
        ? [
            {
              label: 'Rescan',
              icon: 'i-lucide-refresh-cw',
              onSelect: () => void rescan(folder.id),
            },
          ]
        : []
    }
    case 'delete':
    case 'game-alias':
      return []
  }
}
