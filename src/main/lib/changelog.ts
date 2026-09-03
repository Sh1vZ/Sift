import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { changelogSection, changelogToText } from '@shared/changelog'

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
 * Release notes for one version as display text, or '' when the changelog is
 * missing or has no section for it. Never throws: a missing changelog degrades to
 * silence rather than breaking startup.
 */
export async function releaseNotesFor(version: string): Promise<string> {
  for (const file of candidates()) {
    try {
      const md = await readFile(file, 'utf8')
      const section = changelogSection(md, version)
      if (section) return changelogToText(section)
    } catch {
      /* try the next location; absence is not an error */
    }
  }
  return ''
}
