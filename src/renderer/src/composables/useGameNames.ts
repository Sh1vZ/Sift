import { confirm, prompt } from './useDialogs'
import { setGameAlias, type GameSummary } from './useLibrary'

/**
 * The dialog side of renaming and merging games, kept out of `useLibrary` the
 * way `useClipMenu` keeps clip dialogs out of it: the store owns the state and
 * the IPC call, this owns the copy and the confirmations.
 *
 * All three are display-only. Nothing on disk is ever renamed or moved — the
 * folders keep the names the recorder gave them.
 */

export async function renameGameDialog(g: GameSummary): Promise<void> {
  const name = await prompt({
    title: 'Rename game',
    label: 'Shown on the Games screen — the folder keeps its name',
    value: g.name,
    confirmLabel: 'Rename',
  })
  if (name === null || name.trim() === g.name) return
  await setGameAlias(g.sources, name)
}

/** Folds `from` into `into`, so both show as one card. */
export async function mergeGamesDialog(from: GameSummary, into: GameSummary): Promise<void> {
  if (from.name === into.name) return
  const ok = await confirm({
    title: `Merge “${from.name}” into “${into.name}”?`,
    message:
      'They become one card sharing one grid. Nothing on disk is renamed or moved, and you can split them again from the game’s menu.',
    detail: `${from.count} clip${from.count === 1 ? '' : 's'} → ${into.name}`,
    detailIcon: 'i-lucide-merge',
    confirmLabel: 'Merge',
  })
  if (!ok) return
  await setGameAlias(from.sources, into.name)
}

/** Puts a renamed or merged game back under the names its folders gave it. */
export async function splitGameDialog(g: GameSummary): Promise<void> {
  const ok = await confirm({
    title: g.sources.length === 1 ? 'Use the folder name again?' : 'Undo the merge?',
    message:
      g.sources.length === 1
        ? 'The card goes back to the name its folder has on disk.'
        : `This card splits back into ${g.sources.length} games, one per folder, exactly as before the merge.`,
    detail: g.sources.join(', '),
    detailIcon: 'i-lucide-folder',
    confirmLabel: g.sources.length === 1 ? 'Reset name' : 'Undo merge',
  })
  if (!ok) return
  await setGameAlias(g.sources, null)
}
