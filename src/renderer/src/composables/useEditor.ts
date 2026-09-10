import { computed, ref, shallowRef } from 'vue'
import type { Clip, ExportJob, ExportKind } from '@shared/types'
import { clamp } from '@/utils/format'
import { audibleTracks, tracks as mixerTracks } from './useAudioMixer'
import { exportAudio, exportClip } from './useExports'
import { toast } from './useToasts'

const api = window.api

/** Shortest cut the editor accepts, in seconds. Mirrors the check in main. */
export const MIN_SELECTION_S = 0.25

/**
 * Edit-mode state for the player's trim tools. One clip is edited at a time,
 * so the state is module-scope and reset whenever the player's clip changes.
 */
export const editing = ref(false)
export const inSec = ref(0)
export const outSec = ref(0)
export const exportMuted = ref(false)
/**
 * Audio tracks the export keeps, or `null` for all of them.
 *
 * Read from the mixer as it stands rather than snapshotted when edit mode
 * opens: the mixer sits in the edit bar next to the Export button, so choosing
 * a track there is usually the last thing done before exporting, and a
 * snapshot would carry whatever was audible before that choice.
 */
export const exportTracks = computed<number[] | null>(() => {
  const audible = audibleTracks.value
  // Only a real subset is worth sending: "all of them" is what absent means,
  // and it keeps the request identical to what it was before the mixer existed.
  return audible.length < mixerTracks.value.length ? [...audible] : null
})
export const exportName = ref('')
/** Which export is on its way to main (or waiting on its save dialog); null when neither is. */
export const submittingKind = ref<ExportKind | null>(null)
export const submitting = computed(() => submittingKind.value !== null)
/** Whether the clip being edited has any sound to export. */
const sourceHasAudio = ref(false)

let duration = 0

export const selectionLength = computed(() => outSec.value - inSec.value)
export const canExport = computed(
  () =>
    editing.value &&
    !submitting.value &&
    exportName.value.trim().length > 0 &&
    selectionLength.value >= MIN_SELECTION_S,
)

/** Why Export is off, in words, or empty when it is not: the row shows this beside the button. */
export const exportProblem = computed(() => {
  if (!editing.value) return ''
  if (!exportName.value.trim()) return 'Give the clip a name'
  if (selectionLength.value < MIN_SELECTION_S)
    return `Selection is too short (at least ${MIN_SELECTION_S} s)`
  return ''
})

/**
 * Why Export audio is off, or empty. Everything Export needs, and a track
 * for the sound to come from. Shown in the button's tooltip rather than
 * beside it: a silent clip would otherwise carry the notice the whole time.
 */
export const audioProblem = computed(() => {
  if (!editing.value) return ''
  if (!sourceHasAudio.value) return 'Source has no audio'
  if (exportTracks.value?.length === 0) return 'Every track is muted in the mixer'
  return exportProblem.value
})
export const canExportAudio = computed(() => canExport.value && !audioProblem.value)

/**
 * The trim bar's filmstrip for the clip in the player: keyframes from across
 * the whole clip, cut by main the first time the clip is opened and cached
 * from then on. Asked for as the player opens rather than when the trim bar
 * does, so it is usually cut by the time the bar is on screen; and the bar
 * shows it whole once it is, never half-drawn.
 */
export interface Filmstrip {
  id: string
  /** Frames in the strip; 0 until it is cut. */
  count: number
  /** URL of the strip; '' while it is still being cut. */
  strip: string
}
export const filmstrip = shallowRef<Filmstrip | null>(null)
/** Which ask the answer belongs to: an ask cancelled by a later one must not clear the later one's state. */
let filmAsk = 0

/** Asks main for the clip's strip, unless it is already here or on its way. */
export function prepareFilmstrip(clip: Clip): void {
  if (clip.kind !== 'video' || filmstrip.value?.id === clip.id) return
  const ask = ++filmAsk
  filmstrip.value = { id: clip.id, count: 0, strip: '' }
  void api.clips.filmstrip(clip.id).then((res) => {
    if (ask !== filmAsk) return
    if (res.ok && res.film) {
      filmstrip.value = { id: clip.id, count: res.frames ?? 0, strip: api.thumbUrl(res.film) }
    } else {
      // The bar keeps to the sprite; the next open of this clip asks again.
      filmstrip.value = null
    }
  })
}

/**
 * The open clip was renamed: same strip, new id and (main moved the file) new
 * name. Asked without the stand-in reset `prepareFilmstrip` does, so a bar
 * mid-trim never blinks back to the sprite; the answer is immediate, as the
 * frames are already on disk.
 */
export function rekeyFilmstrip(clip: Clip): void {
  const had = filmstrip.value
  if (clip.kind !== 'video' || !had || had.id === clip.id) return
  const ask = ++filmAsk
  filmstrip.value = { ...had, id: clip.id }
  void api.clips.filmstrip(clip.id).then((res) => {
    if (ask !== filmAsk) return
    filmstrip.value =
      res.ok && res.film
        ? { id: clip.id, count: res.frames ?? 0, strip: api.thumbUrl(res.film) }
        : null
  })
}

export function enterEdit(clip: Clip): void {
  duration = clip.duration
  inSec.value = 0
  outSec.value = duration
  exportMuted.value = false
  sourceHasAudio.value = clip.hasAudio
  exportName.value = `${clip.title} - Clip`
  editing.value = true
  prepareFilmstrip(clip)
}

export function exitEdit(): void {
  editing.value = false
}

export function setIn(t: number): void {
  inSec.value = clamp(t, 0, Math.max(0, outSec.value - MIN_SELECTION_S))
}

export function setOut(t: number): void {
  outSec.value = clamp(t, Math.min(duration, inSec.value + MIN_SELECTION_S), duration)
}

export function resetRange(): void {
  inSec.value = 0
  outSec.value = duration
}

export async function submit(clip: Clip): Promise<ExportJob | null> {
  if (!canExport.value) return null
  submittingKind.value = 'clip'
  try {
    const job = await exportClip({
      id: clip.id,
      name: exportName.value.trim(),
      start: inSec.value,
      end: outSec.value,
      muted: exportMuted.value,
      tracks: exportTracks.value ?? undefined,
    })
    if (job) {
      toast('info', 'Exporting clip', `${job.name}${job.ext} · ${job.game}`)
      exitEdit()
    }
    return job
  } finally {
    submittingKind.value = null
  }
}

/**
 * The selection's audio alone, to wherever the save dialog ends up. The mixer's
 * choice of tracks carries over exactly as it does for the clip; the mute does
 * not — asking for the audio is asking for sound.
 */
export async function submitAudio(clip: Clip): Promise<ExportJob | null> {
  if (!canExportAudio.value) return null
  submittingKind.value = 'audio'
  try {
    const job = await exportAudio({
      id: clip.id,
      name: exportName.value.trim(),
      start: inSec.value,
      end: outSec.value,
      tracks: exportTracks.value ?? undefined,
    })
    if (job) {
      toast('info', 'Exporting audio', `${job.name}${job.ext}`)
      exitEdit()
    }
    return job
  } finally {
    submittingKind.value = null
  }
}
