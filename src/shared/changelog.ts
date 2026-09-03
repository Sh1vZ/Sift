/**
 * Reading `CHANGELOG.md`. One implementation is shared by the release script
 * (which extracts the section for a tag into the GitHub release body) and by the
 * main process (which shows the section for the running version after an update),
 * so the published notes and the in-app notes can never disagree.
 */

/** A version heading: `## …`, but not the `### Added` sub-headings inside a section. */
const HEADING = /^##\s+/

/** `## [v1.0.0-beta.1] - 2026-09-03` -> `1.0.0-beta.1`; `## 1.0.0` -> `1.0.0`. */
function headingVersion(line: string): string {
  const first = line.replace(HEADING, '').trim().split(/\s+/)[0] ?? ''
  return first.replace(/^\[/, '').replace(/\]$/, '').replace(/^v/i, '')
}

/**
 * The body of the `## [x.y.z]` section of a Keep a Changelog document, without
 * its heading. Empty when the document has no section for that version — which
 * the release script treats as a hard failure and the app treats as silence.
 *
 * A leading `v` is ignored on both sides, so a `v1.2.3` tag finds a `## [1.2.3]`
 * heading and vice versa.
 */
export function changelogSection(md: string, version: string): string {
  const want = version.trim().replace(/^v/i, '')
  if (!md || !want) return ''

  const lines = md.split(/\r?\n/)
  let start = -1
  for (let i = 0; i < lines.length; i++) {
    if (!HEADING.test(lines[i] ?? '')) continue
    // The next version heading ends the section we are collecting.
    if (start !== -1) return lines.slice(start, i).join('\n').trim()
    if (headingVersion(lines[i] ?? '') === want) start = i + 1
  }
  return start === -1 ? '' : lines.slice(start).join('\n').trim()
}

/**
 * Flattens a changelog section into the plain text the UI renders in a `pre-wrap`
 * block. Sift ships no markdown renderer on purpose — see the note on
 * `UpdateState.notes` — so the few constructs a changelog actually uses are
 * turned into something readable and everything else is left alone.
 */
export function changelogToText(section: string): string {
  return section
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*#{3,}\s*/, '').replace(/^(\s*)[-*]\s+/, '$1• '))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}
