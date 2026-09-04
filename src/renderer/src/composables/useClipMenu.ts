import type { Clip, ExportJob } from '@shared/types'
import { confirmWithAlt, prompt } from './useDialogs'
import { cancelExport, dismissExport } from './useExports'
import {
  copyClipFile,
  copyClipPath,
  copyYouTubeLink,
  deleteClip,
  games,
  getClip,
  markSeen,
  openGame,
  openYouTube,
  pendingByClip,
  removeFromYouTube,
  renameClip,
  revealClip,
} from './useLibrary'
import type { Rect } from './useMotion'
import { openClip, openSource } from './usePlayer'
import { toast } from './useToasts'
import { cancelUpload, openUploadDialog, uploadByClip } from './useUploads'

/**
 * The one list of things you can do to a clip. The card's right-click menu,
 * the player's "More" menu and the details pane all read it, so an action
 * added here shows up everywhere at once and every surface agrees on the
 * disabled states.
 */
export interface ClipMenuItem {
  label: string
  icon: string
  disabled?: boolean
  color?: 'error'
  onSelect: () => void
}

export interface ClipMenuOptions {
  /** `export` cards get the Clips view's extra entries (source recording, go to game). */
  variant: 'recording' | 'export'
  /** An export placeholder card: the menu is only Cancel or Dismiss. */
  job?: ExportJob
  /** Where the open animation starts from; grids pass the card's thumb rect. */
  rectOf?: (clip: Clip) => Rect | null
  /** Leave out Play and Trim & export — the player already shows both. */
  omitOpen?: boolean
  /** After a rename: the player swaps its `current` to the new record. */
  onRenamed?: (next: Clip) => void
  /** Before a delete goes through: the player steps to a neighbour first. */
  beforeDelete?: () => void
}

export async function renameClipDialog(clip: Clip): Promise<Clip | null> {
  const name = await prompt({
    title: 'Rename clip',
    label: 'File name',
    value: clip.name,
    confirmLabel: 'Rename',
  })
  if (!name?.trim() || name === clip.name) return null
  return renameClip(clip, name)
}

export async function deleteClipDialog(clip: Clip, before?: () => void): Promise<boolean> {
  const choice = await confirmWithAlt({
    title: 'Delete this clip?',
    message:
      'It goes to the Recycle Bin, so you can still restore it from there. Deleting permanently erases the file from disk right away.',
    detail: clip.name + clip.ext,
    detailIcon: 'i-lucide-file-video',
    confirmLabel: 'Delete',
    danger: true,
    alt: { label: 'Delete permanently', danger: true },
  })
  if (choice === 'cancel') return false
  before?.()
  return deleteClip(clip, choice === 'alt')
}

/** Jump to the recording an export was cut from, or say why that is not possible. */
export function showSource(clip: Clip): void {
  if (!openSource(clip))
    toast(
      'error',
      'Source not found',
      'The recording this clip was cut from is no longer in the library.',
    )
}

export function clipMenuItems(clip: Clip, opts: ClipMenuOptions): ClipMenuItem[][] {
  const job = opts.job
  if (job) {
    const active = job.state === 'queued' || job.state === 'running'
    return [
      [
        active
          ? {
              label: 'Cancel export',
              icon: 'i-lucide-x',
              color: 'error',
              onSelect: () => void cancelExport(job.id),
            }
          : { label: 'Dismiss', icon: 'i-lucide-x', onSelect: () => dismissExport(job.id) },
      ],
    ]
  }
  const from = opts.variant === 'export' ? 'clips' : 'library'
  const rect = (): Rect | null => opts.rectOf?.(clip) ?? null
  const main: ClipMenuItem[] = opts.omitOpen
    ? []
    : [
        { label: 'Play', icon: 'i-lucide-play', onSelect: () => openClip(clip, rect(), from) },
        {
          label: 'Trim & export',
          icon: 'i-lucide-scissors',
          disabled: clip.probeState !== 'ok' || !clip.duration,
          onSelect: () => openClip(clip, rect(), from, true),
        },
      ]
  if (opts.variant === 'export') {
    main.push(
      {
        label: 'Open source recording',
        icon: 'i-lucide-link',
        disabled: !clip.sourceId || !getClip(clip.sourceId),
        onSelect: () => showSource(clip),
      },
      {
        label: 'Go to game',
        icon: 'i-lucide-gamepad-2',
        disabled: !games.value.some((g) => g.name === clip.game),
        onSelect: () => openGame(clip.game),
      },
    )
  }
  // Something slow is already running on this clip: the actions that would
  // collide with it wait until it lands.
  const busy = Boolean(pendingByClip.value[clip.id])
  main.push(
    // The watched flag is set for you at 90 % of playback; this is the override
    // for a clip you skimmed, or one you want back in the unwatched list.
    {
      label: clip.seenAtMs ? 'Mark as unwatched' : 'Mark as watched',
      icon: clip.seenAtMs ? 'i-lucide-eye-off' : 'i-lucide-eye',
      onSelect: () => void markSeen(clip, !clip.seenAtMs),
    },
    { label: 'Show in Explorer', icon: 'i-lucide-folder-open', onSelect: () => revealClip(clip) },
    {
      label: 'Copy file',
      icon: 'i-lucide-clipboard-copy',
      disabled: busy,
      onSelect: () => void copyClipFile(clip),
    },
    { label: 'Copy path', icon: 'i-lucide-copy', onSelect: () => void copyClipPath(clip) },
    {
      label: 'Rename',
      icon: 'i-lucide-pencil',
      disabled: busy,
      onSelect: () =>
        void renameClipDialog(clip).then((next) => {
          if (next) opts.onRenamed?.(next)
        }),
    },
  )
  // Sharing gets its own group: a live upload swaps the entry for its Cancel.
  const up = uploadByClip.value[clip.id]
  const uploading = Boolean(up && (up.state === 'queued' || up.state === 'uploading'))
  const share: ClipMenuItem[] = uploading
    ? [
        {
          label: 'Cancel upload',
          icon: 'i-lucide-x',
          color: 'error',
          onSelect: () => void cancelUpload(up.id),
        },
      ]
    : [
        {
          label: clip.youtubeId ? 'Upload to YouTube again' : 'Upload to YouTube',
          icon: 'i-lucide-youtube',
          disabled: clip.probeState !== 'ok' || busy,
          onSelect: () => openUploadDialog(clip),
        },
      ]
  if (clip.youtubeId && !uploading) {
    share.push(
      {
        label: 'Open on YouTube',
        icon: 'i-lucide-external-link',
        onSelect: () => void openYouTube(clip),
      },
      {
        label: 'Copy YouTube link',
        icon: 'i-lucide-link-2',
        onSelect: () => void copyYouTubeLink(clip),
      },
      {
        label: 'Remove from YouTube',
        icon: 'i-lucide-cloud-off',
        color: 'error',
        disabled: busy,
        onSelect: () => void removeFromYouTube(clip),
      },
    )
  }
  return [
    main,
    share,
    [
      {
        label: 'Delete',
        icon: 'i-lucide-trash-2',
        color: 'error',
        disabled: busy,
        onSelect: () => void deleteClipDialog(clip, opts.beforeDelete),
      },
    ],
  ]
}
