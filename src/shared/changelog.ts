/**
 * Reading `CHANGELOG.md`. One implementation is shared by the release script
 * (which extracts the section for a tag into the GitHub release body) and by the
 * main process (which shows the section for the running version after an update),
 * so the published notes and the in-app notes can never disagree.
 *
 * The markdown is parsed here into a small block/inline tree rather than into
 * HTML. The renderer walks that tree with `v-for` and text interpolation, so no
 * markup ever crosses the IPC boundary and there is no `v-html` anywhere in the
 * app — the parser is the sanitiser, and it only emits shapes the UI can draw.
 */

/** A version heading: `## …`, but not the `### Added` sub-headings inside a section. */
const HEADING = /^##\s+/

/** `## [v1.0.0-beta.1] - 2026-09-03` -> `1.0.0-beta.1`; `## 1.0.0` -> `1.0.0`. */
function headingVersion(line: string): string {
  const first = line.replace(HEADING, '').trim().split(/\s+/)[0] ?? ''
  return first.replace(/^\[/, '').replace(/\]$/, '').replace(/^v/i, '')
}

/** `## [1.0.0] - 2026-09-03` -> `2026-09-03`; '' when the heading carries no date. */
function headingDate(line: string): string {
  return /-\s*(\d{4}-\d{2}-\d{2})\s*$/.exec(line)?.[1] ?? ''
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

// ------------------------------------------------------------------ markdown

/** A run of inline text. `code` and `link` are the only shapes that carry chrome. */
export type ChangelogInline =
  | { kind: 'text'; text: string }
  | { kind: 'strong'; text: string }
  | { kind: 'em'; text: string }
  | { kind: 'code'; text: string }
  | { kind: 'link'; text: string; href: string }

/** One `- ` bullet, with any bullets nested under it. */
export interface ChangelogItem {
  content: ChangelogInline[]
  children: ChangelogItem[]
}

/**
 * The three block shapes a changelog actually uses. Anything else in the source
 * (tables, images, code fences) degrades to paragraphs rather than being dropped.
 */
export type ChangelogBlock =
  | { kind: 'heading'; text: string }
  | { kind: 'paragraph'; content: ChangelogInline[] }
  | { kind: 'list'; items: ChangelogItem[] }

/** One `## [x.y.z] - date` section, parsed. */
export interface ChangelogRelease {
  version: string
  /** `YYYY-MM-DD` from the heading; '' when it carries no date. */
  date: string
  blocks: ChangelogBlock[]
}

/**
 * Inline markdown, in precedence order: code spans win over everything (so a
 * `**` inside backticks stays literal), then links, then bold, then italic.
 *
 * Underscore emphasis (`_x_`, `__x__`) is deliberately unsupported: identifiers
 * like `SIFT_USER_DATA` appear in these notes far more often than italics do.
 */
const INLINE = /`([^`\n]+)`|\[([^\]\n]+)\]\(([^)\s]+)\)|\*\*([^*\n]+)\*\*|\*([^*\n]+)\*/g

/**
 * Only web links become links. A `javascript:` or `file:` href in the changelog
 * would be a bug at best, so it renders as the plain text it is rather than as
 * something clickable.
 */
function safeHref(href: string): string {
  return /^https?:\/\//i.test(href) ? href : ''
}

/** Undoes the backslash escapes markdown allows, once all delimiters are consumed. */
function unescape(text: string): string {
  return text.replace(/\\([\\`*_[\]()#+\-.!])/g, '$1')
}

function push(out: ChangelogInline[], node: ChangelogInline): void {
  if (node.kind === 'text' && !node.text) return
  out.push(node)
}

/** Splits one logical line of markdown into styled runs. */
export function parseInline(line: string): ChangelogInline[] {
  const out: ChangelogInline[] = []
  let last = 0
  INLINE.lastIndex = 0

  for (let m = INLINE.exec(line); m; m = INLINE.exec(line)) {
    push(out, { kind: 'text', text: unescape(line.slice(last, m.index)) })
    const [, code, linkText, linkHref, strong, em] = m

    if (code !== undefined) {
      // Not unescaped: a code span is literal by definition.
      push(out, { kind: 'code', text: code })
    } else if (linkText !== undefined && linkHref !== undefined) {
      const href = safeHref(linkHref)
      push(
        out,
        href
          ? { kind: 'link', text: unescape(linkText), href }
          : { kind: 'text', text: unescape(`${linkText} (${linkHref})`) },
      )
    } else if (strong !== undefined) {
      push(out, { kind: 'strong', text: unescape(strong) })
    } else if (em !== undefined) {
      push(out, { kind: 'em', text: unescape(em) })
    }
    last = m.index + m[0].length
  }

  push(out, { kind: 'text', text: unescape(line.slice(last)) })
  return out
}

/** `- text`, `* text`, `+ text`, with its indent measured in spaces. */
const BULLET = /^(\s*)[-*+]\s+(.*)$/
/** `### Added`, and any other ATX heading that survives into a section. */
const SUB_HEADING = /^\s{0,3}#{1,6}\s+(.*?)\s*#*\s*$/

/**
 * A bullet while it is still being read. The raw source is kept as a string so a
 * wrapped line can simply be appended, and the whole item is parsed once at the
 * end — re-parsing a partially parsed item would re-interpret its escapes.
 */
interface Draft {
  text: string
  children: Draft[]
}

/** A stack level: the bullets at one indent, and the indent they sit at. */
interface Frame {
  indent: number
  items: Draft[]
}

function toItem(draft: Draft): ChangelogItem {
  return { content: parseInline(draft.text), children: draft.children.map(toItem) }
}

/**
 * Parses a changelog section into blocks.
 *
 * The one thing this must get right is **lazy continuation**: Keep a Changelog
 * entries are hard-wrapped at ~90 columns with two-space indented continuation
 * lines, and rendering those as literal line breaks is what made the notes look
 * ragged in a narrow dialog. Continuation lines are joined back into their
 * bullet with a single space and re-wrapped by the browser.
 */
export function parseChangelog(section: string): ChangelogBlock[] {
  const blocks: ChangelogBlock[] = []
  const para: string[] = []
  let stack: Frame[] = []

  const flushPara = (): void => {
    if (!para.length) return
    blocks.push({ kind: 'paragraph', content: parseInline(para.join(' ')) })
    para.length = 0
  }
  const flushList = (): void => {
    const root = stack[0]
    if (root?.items.length) blocks.push({ kind: 'list', items: root.items.map(toItem) })
    stack = []
  }
  /** The bullet a continuation line belongs to: the last one at the deepest level. */
  const openItem = (): Draft | null => {
    const top = stack[stack.length - 1]
    return top ? (top.items[top.items.length - 1] ?? null) : null
  }

  for (const raw of section.split(/\r?\n/)) {
    // Tabs are rare here, but a tab-indented bullet must not read as top level.
    const line = raw.replace(/\t/g, '  ')

    if (!line.trim()) {
      // A blank ends a paragraph but leaves a list open: `- a\n\n- b` is one list.
      flushPara()
      continue
    }

    const heading = SUB_HEADING.exec(line)
    if (heading) {
      flushPara()
      flushList()
      blocks.push({ kind: 'heading', text: unescape(heading[1] ?? '') })
      continue
    }

    const bullet = BULLET.exec(line)
    if (bullet) {
      flushPara()
      const indent = (bullet[1] ?? '').length
      const item: Draft = { text: bullet[2] ?? '', children: [] }

      if (!stack.length) {
        stack.push({ indent, items: [] })
      } else {
        while (stack.length > 1 && indent < (stack[stack.length - 1]?.indent ?? 0)) stack.pop()
        const top = stack[stack.length - 1]
        const parent = openItem()
        if (top && parent && indent >= top.indent + 2)
          stack.push({ indent, items: parent.children })
      }
      stack[stack.length - 1]?.items.push(item)
      continue
    }

    const indented = /^\s{2,}/.test(line)
    const item = indented ? openItem() : null
    if (item) {
      // Lazy continuation: fold the wrapped line back into the bullet above it.
      item.text = `${item.text} ${line.trim()}`.trim()
      continue
    }

    // A flush-left paragraph after a list ends the list.
    flushList()
    para.push(line.trim())
  }

  flushPara()
  flushList()
  return blocks
}

/**
 * Every released version in a changelog, newest first — the order they appear in
 * the file. Used for the "Full changelog" view in the What's new dialog.
 */
export function changelogReleases(md: string): ChangelogRelease[] {
  if (!md) return []
  const lines = md.split(/\r?\n/)
  const releases: ChangelogRelease[] = []

  let heading = ''
  let body: string[] = []
  const close = (): void => {
    if (!heading) return
    const version = headingVersion(heading)
    if (version) {
      releases.push({
        version,
        date: headingDate(heading),
        blocks: parseChangelog(body.join('\n')),
      })
    }
  }

  for (const line of lines) {
    if (HEADING.test(line)) {
      close()
      heading = line
      body = []
      continue
    }
    if (heading) body.push(line)
  }
  close()
  return releases
}
