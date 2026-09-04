import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  changelogReleases,
  changelogSection,
  parseChangelog,
  type ChangelogBlock,
  type ChangelogRelease
} from '@shared/changelog'

/**
 * The bundled `CHANGELOG.md`. A packaged build gets it from extraResources
 * (electron-builder.yml) because the asar ships only out/**; dev reads it from the
 * project root. Mirrors `appIconPath` in paths.ts.
 *
 * Notes for the *installed* version come from this file rather than the update
 * feed: the feed describes a newer build, and by the time a version is running
 * there is nothing left to fetch. Bundling also means it works offline.
 */
function candidates(): string[] {
  return [
    join(process.resourcesPath, 'CHANGELOG.md'),
    join(import.meta.dirname, '../../CHANGELOG.md')
  ]
}

/**
 * The bundled changelog, or '' when it is missing. Never throws: an absent
 * changelog degrades to silence rather than breaking startup.
 */
async function read(): Promise<string> {
  for (const file of candidates()) {
    try {
      return await readFile(file, 'utf8')
    } catch {
      /* try the next location; absence is not an error */
    }
  }
  return ''
}

/**
 * Release notes for one version as parsed blocks, or an empty array when the
 * changelog is missing or has no section for it.
 */
export async function releaseNotesFor(version: string): Promise<ChangelogBlock[]> {
  const section = changelogSection(await read(), version)
  return section ? parseChangelog(section) : []
}

/** Every version in the bundled changelog, newest first, for the full-history view. */
export async function fullChangelog(): Promise<ChangelogRelease[]> {
  return changelogReleases(await read())
}
