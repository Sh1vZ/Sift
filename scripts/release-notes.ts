/**
 * Extracts the CHANGELOG section for the version in package.json into
 * `build/release-notes.md`, which electron-builder uses as the GitHub release
 * body and embeds in the update manifest (`releaseInfo.releaseNotesFile`).
 *
 * Exits non-zero when the section is missing, so a release can never ship
 * untitled. CI runs this right after `npm ci` — before the six-minute build.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { changelogSection } from '@shared/changelog'

const root = process.cwd()

function packageVersion(): string {
  const raw: unknown = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
  if (typeof raw !== 'object' || raw === null || !('version' in raw)) return ''
  const version = raw.version
  return typeof version === 'string' ? version : ''
}

function main(): void {
  const version = packageVersion()
  if (!version) {
    console.error('release-notes: package.json has no version')
    process.exit(1)
  }

  const section = changelogSection(readFileSync(join(root, 'CHANGELOG.md'), 'utf8'), version)
  if (!section) {
    console.error(
      `release-notes: CHANGELOG.md has no "## [${version}]" section. Add one before tagging.`,
    )
    process.exit(1)
  }

  const out = join(root, 'build', 'release-notes.md')
  mkdirSync(dirname(out), { recursive: true })
  writeFileSync(out, `${section}\n`, 'utf8')
  console.log(
    `release-notes: wrote ${section.split('\n').length} line(s) for ${version} to build/release-notes.md`,
  )
}

main()
