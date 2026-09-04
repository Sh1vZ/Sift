/**
 * The local half of shipping a version. `.github/workflows/release.yml` does the
 * build and the publish; everything before the tag lands here so it happens the
 * same way every time.
 *
 *   npm run release -- beta          1.0.0-beta.2 -> 1.0.0-beta.3
 *   npm run release -- stable        1.0.0-beta.3 -> 1.0.0
 *   npm run release -- minor         1.0.0-beta.3 -> 1.1.0
 *   npm run release -- 1.2.0-beta.1  an exact version
 *
 * Flags: --dry-run (decide and report, change nothing), --yes (no prompt, required
 * when stdin is not a terminal), --skip-checks (no typecheck/test — CI still runs
 * them), --no-push (stop after the tag).
 *
 * A pushed tag is expensive to take back: the release, its assets and the update
 * manifest all exist the moment CI finishes. So every check that can fail runs
 * *before* anything is committed, and each one names the fix rather than just the
 * problem.
 */
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import { changelogSection } from '@shared/changelog'

const ROOT = process.cwd()
const BRANCH = 'main'

/** Files the release commit is allowed to pick up; anything else dirty is someone's unfinished work. */
const RELEASE_FILES = ['CHANGELOG.md', 'package.json', 'package-lock.json']
/** Generated per run and gitignored, so a leftover copy must not read as a dirty tree. */
const IGNORED_DIRTY = new Set([...RELEASE_FILES, 'build/release-notes.md'])

const SEMVER = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/
const BETA = /^beta\.(\d+)$/

interface Options {
  bump: string
  dryRun: boolean
  yes: boolean
  skipChecks: boolean
  push: boolean
}

class ReleaseError extends Error {
  constructor(
    message: string,
    readonly hint: string[] = []
  ) {
    super(message)
  }
}

function fail(message: string, ...hint: string[]): never {
  throw new ReleaseError(message, hint)
}

function step(message: string): void {
  console.log(`\n[1m${message}[0m`)
}

function note(message: string): void {
  console.log(`  ${message}`)
}

function warn(message: string): void {
  console.log(`  [33mwarning:[0m ${message}`)
}

function gitRaw(...args: string[]): string {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
}

function git(...args: string[]): string {
  return gitRaw(...args).trim()
}

/**
 * Runs an npm script with its output attached, so a failing typecheck reads
 * normally. One shell string rather than an argv: `npm` is `npm.cmd` on Windows,
 * which needs a shell, and passing an argv array alongside `shell: true` earns a
 * deprecation warning on every call. Every argument here is a literal or a
 * version already matched against the semver pattern.
 */
function npm(...args: string[]): void {
  const command = `npm ${args.join(' ')}`
  const result = spawnSync(command, { cwd: ROOT, stdio: 'inherit', shell: true })
  if (result.status !== 0) fail(`\`${command}\` failed`)
}

function parseArgs(argv: string[]): Options {
  const options: Options = { bump: '', dryRun: false, yes: false, skipChecks: false, push: true }
  for (const arg of argv) {
    if (arg === '--dry-run') options.dryRun = true
    else if (arg === '--yes' || arg === '-y') options.yes = true
    else if (arg === '--skip-checks') options.skipChecks = true
    else if (arg === '--no-push') options.push = false
    else if (arg.startsWith('-')) fail(`unknown flag ${arg}`)
    else if (options.bump) fail(`unexpected argument ${arg}`, 'Pass one version or bump keyword.')
    else options.bump = arg
  }
  if (!options.bump) {
    fail(
      'no version given',
      'Usage: npm run release -- <beta|stable|patch|minor|major|x.y.z> [--dry-run] [--yes]'
    )
  }
  return options
}

function packageVersion(): string {
  const raw: unknown = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
  const version =
    typeof raw === 'object' && raw !== null && 'version' in raw ? (raw as { version: unknown }).version : ''
  if (typeof version !== 'string' || !SEMVER.test(version)) {
    fail(`package.json version ${JSON.stringify(version)} is not a semver string`)
  }
  return version
}

function parts(version: string): { major: number; minor: number; patch: number; pre: string } {
  const m = SEMVER.exec(version)
  if (!m) fail(`"${version}" is not a valid semver version`)
  return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]), pre: m[4] ?? '' }
}

/**
 * The keywords follow npm's semantics, with one addition: `beta` walks the
 * `-beta.N` counter forward instead of ending the prerelease line, because that
 * is the release this project makes most often.
 */
function nextVersion(current: string, bump: string): string {
  const { major, minor, patch, pre } = parts(current)

  if (bump === 'beta') {
    const n = BETA.exec(pre)
    if (n) return `${major}.${minor}.${patch}-beta.${Number(n[1]) + 1}`
    fail(
      `cannot infer the next beta from ${current}`,
      `${current} is not a \`-beta.N\` version, so the base for the next beta line is a`,
      'decision, not a calculation. Pass it explicitly, e.g.',
      `  npm run release -- ${major}.${minor + 1}.0-beta.1`
    )
  }
  // npm's rule: bumping a prerelease by patch settles it rather than adding one.
  if (bump === 'patch') return pre ? `${major}.${minor}.${patch}` : `${major}.${minor}.${patch + 1}`
  if (bump === 'stable') {
    if (!pre) fail(`${current} is already a stable version`, 'Use `patch`, `minor` or `major` instead.')
    return `${major}.${minor}.${patch}`
  }
  if (bump === 'minor') return pre && patch === 0 ? `${major}.${minor}.0` : `${major}.${minor + 1}.0`
  if (bump === 'major') return pre && minor === 0 && patch === 0 ? `${major}.0.0` : `${major + 1}.0.0`

  const explicit = bump.replace(/^v/i, '')
  if (!SEMVER.test(explicit)) {
    fail(
      `"${bump}" is neither a bump keyword nor a version`,
      'Expected one of: beta, stable, patch, minor, major, or an exact version like 1.2.0-beta.1.'
    )
  }
  const next = parts(explicit)
  const lower =
    next.major < major ||
    (next.major === major && next.minor < minor) ||
    (next.major === major && next.minor === minor && next.patch < patch)
  if (lower) fail(`${explicit} is older than the current version ${current}`)
  if (explicit === current) fail(`${explicit} is already the current version`)
  return explicit
}

function checkGitState(): void {
  step('Checking the working tree')

  const branch = git('rev-parse', '--abbrev-ref', 'HEAD')
  if (branch !== BRANCH) {
    fail(`on branch ${branch}, not ${BRANCH}`, `Releases ship from ${BRANCH}: git switch ${BRANCH}`)
  }

  // Not `git()`: porcelain encodes the status in the first two columns, and
  // trimming the output would eat the leading space of an unstaged first entry.
  const dirty = gitRaw('status', '--porcelain')
    .split('\n')
    .filter((line) => line.length > 3)
    // `R  old -> new` names both sides; the destination is the one to report.
    .map((line) => line.slice(3).split(' -> ').pop() ?? '')
    .filter((path) => !IGNORED_DIRTY.has(path))
  if (dirty.length) {
    fail(
      'the working tree has changes that are not part of a release',
      'Commit or stash them first. Only these may be uncommitted:',
      `  ${RELEASE_FILES.join(', ')}`,
      'Dirty:',
      ...dirty.map((path) => `  ${path}`)
    )
  }

  try {
    git('fetch', '--tags', '--quiet', 'origin')
  } catch {
    warn('could not reach origin; tag and branch checks use the last fetch')
  }

  try {
    const [behind, ahead] = git('rev-list', '--left-right', '--count', `origin/${BRANCH}...HEAD`)
      .split(/\s+/)
      .map(Number)
    if (behind > 0) {
      fail(
        `${BRANCH} is ${behind} commit(s) behind origin/${BRANCH}`,
        'Pull first — a release built from a stale branch ships stale code:',
        '  git pull --ff-only'
      )
    }
    if (ahead > 0) {
      warn(`${ahead} unpushed commit(s) will be pushed with this release:`)
      for (const line of git('log', '--oneline', `origin/${BRANCH}..HEAD`).split('\n')) note(`  ${line}`)
    }
  } catch {
    warn(`no origin/${BRANCH} to compare against`)
  }

  note(`on ${branch}, clean`)
}

function checkTagFree(version: string): void {
  if (git('tag', '--list', `v${version}`)) {
    fail(
      `tag v${version} already exists locally`,
      'That version has been released, or a previous run left the tag behind:',
      `  git tag -d v${version}`
    )
  }
}

/**
 * The changelog is the release body, the notes beside a pending update and the
 * in-app "What's new", so a missing section is a hard stop rather than an empty
 * release. CI checks this too — this is the same check, minutes earlier.
 */
function checkChangelog(version: string): string {
  step('Checking CHANGELOG.md')

  const md = readFileSync(join(ROOT, 'CHANGELOG.md'), 'utf8')
  const section = changelogSection(md, version)
  if (!section) {
    fail(
      `CHANGELOG.md has no section for ${version}`,
      'Add one above the previous version, then run this again:',
      `  ## [${version}] - ${today()}`,
      '',
      '  ### Added',
      '  - …'
    )
  }

  const heading = md
    .split(/\r?\n/)
    .find((line) => /^##\s/.test(line) && line.includes(version))
  const date = heading ? /(\d{4}-\d{2}-\d{2})/.exec(heading)?.[1] : undefined
  if (!date) warn(`the ${version} heading carries no YYYY-MM-DD date`)
  else if (date !== today()) warn(`the ${version} heading is dated ${date}, today is ${today()}`)

  note(`${section.split('\n').length} line(s) of notes`)
  return section
}

function today(): string {
  const now = new Date()
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

/**
 * electron-builder marks every GitHub release with one flag for the whole repo,
 * and electron-updater only offers a prerelease to a build that is itself a
 * prerelease. Ship a stable version under `releaseType: prerelease` and no stable
 * user is ever offered it — silently, forever. Cheap to check, expensive to miss.
 */
function checkPublishChannel(version: string): void {
  step('Checking the publish channel')

  const yml = readFileSync(join(ROOT, 'electron-builder.yml'), 'utf8')
  const releaseType = /^\s*releaseType:\s*(\S+)/m.exec(yml)?.[1] ?? 'draft'
  const isPrerelease = version.includes('-')

  if (isPrerelease && releaseType !== 'prerelease') {
    fail(
      `${version} is a prerelease but electron-builder.yml has releaseType: ${releaseType}`,
      'Set `releaseType: prerelease` in electron-builder.yml, commit, then run this again.'
    )
  }
  if (!isPrerelease && releaseType !== 'release') {
    fail(
      `${version} is a stable version but electron-builder.yml has releaseType: ${releaseType}`,
      'A stable build never offers itself a prerelease, so nobody would be updated to this.',
      'Set `releaseType: release` in electron-builder.yml, commit, then run this again.'
    )
  }
  note(`publishing as ${releaseType}`)
}

function repoUrl(): string {
  try {
    return git('remote', 'get-url', 'origin').replace(/\.git$/, '')
  } catch {
    return 'https://github.com/Sh1vZ/Sift'
  }
}

async function confirm(question: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  try {
    return await new Promise<boolean>((resolve) => {
      rl.question(`${question} [y/N] `, (answer) => resolve(/^y(es)?$/i.test(answer.trim())))
    })
  } finally {
    rl.close()
  }
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2))
  if (!existsSync(join(ROOT, 'package.json'))) fail('run this from the repository root')

  const current = packageVersion()
  const version = nextVersion(current, options.bump)
  const tag = `v${version}`

  console.log(`[1mSift release: ${current} -> ${version}[0m${options.dryRun ? '  (dry run)' : ''}`)

  checkGitState()
  checkTagFree(version)
  // Before the changelog: if the channel is wrong the version itself is wrong,
  // and there is no point asking for notes about a release that cannot ship.
  checkPublishChannel(version)
  checkChangelog(version)

  if (options.dryRun) {
    step('Dry run, stopping here. It would have:')
    note(`set package.json and package-lock.json to ${version}`)
    if (!options.skipChecks) note('run npm run typecheck and npm test')
    note('written build/release-notes.md from the changelog section')
    note(`committed chore(release): ${version}`)
    note(`tagged ${tag}`)
    if (options.push) note(`pushed ${BRANCH} and ${tag} to origin`)
    return
  }

  // Everything past here changes the repository. `undo` grows as that happens so
  // a failure can print the exact way back rather than leaving a half-release.
  const undo: string[] = []
  try {
    step(`Setting the version to ${version}`)
    npm('version', version, '--no-git-tag-version', '--allow-same-version')
    undo.push(`git checkout -- package.json package-lock.json`)

    if (!options.skipChecks) {
      step('Typechecking')
      npm('run', 'typecheck')
      step('Testing')
      npm('test')
    }

    step('Writing the release notes')
    npm('run', 'release:notes')

    step('Committing and tagging')
    git('add', ...RELEASE_FILES)
    git('commit', '-m', `chore(release): ${version}`)
    undo.length = 0
    undo.push('git reset --hard HEAD~1')
    // Annotated on purpose: `git push --follow-tags` skips lightweight tags, so a
    // `git tag v…` would push nothing and the workflow would never fire.
    git('tag', '-a', tag, '-m', `Sift ${version}`)
    undo.unshift(`git tag -d ${tag}`)
    note(`${tag} on ${git('rev-parse', '--short', 'HEAD')}`)

    if (!options.push) {
      step('Not pushing (--no-push). When you are ready:')
      note(`git push --follow-tags origin ${BRANCH}`)
      return
    }

    if (!options.yes) {
      if (!process.stdin.isTTY) {
        fail(
          'refusing to push without confirmation',
          'stdin is not a terminal, so pass --yes to push, or --no-push to stop at the tag.'
        )
      }
      step('Ready to publish')
      note(`push ${BRANCH} and ${tag} to origin — this starts the release build and cannot be undone quietly`)
      if (!(await confirm('  Push?'))) {
        fail(
          'not pushed',
          'The commit and tag are in place. Push when ready:',
          `  git push --follow-tags origin ${BRANCH}`,
          'Or undo:',
          ...undo.map((line) => `  ${line}`)
        )
      }
    }

    step('Pushing')
    const push = spawnSync('git', ['push', '--follow-tags', 'origin', BRANCH], { cwd: ROOT, stdio: 'inherit' })
    if (push.status !== 0) fail('push failed', 'Fix the cause and retry:', `  git push --follow-tags origin ${BRANCH}`)

    const url = repoUrl()
    step(`Shipped ${tag}. CI builds and publishes it now (~10 min).`)
    note(`Build:   ${url}/actions/workflows/release.yml`)
    note(`Release: ${url}/releases/tag/${tag}`)
    note('Check the release is not a draft and carries the installer, latest.yml and the .blockmap.')
  } catch (error) {
    if (undo.length && error instanceof ReleaseError && error.hint.length === 0) {
      error.hint.push('Undo the local changes with:', ...undo.map((line) => `  ${line}`))
    }
    throw error
  }
}

main().catch((error: unknown) => {
  if (error instanceof ReleaseError) {
    console.error(`\n[31mrelease: ${error.message}[0m`)
    for (const line of error.hint) console.error(line)
  } else {
    console.error(`\n[31mrelease: ${error instanceof Error ? error.message : String(error)}[0m`)
  }
  process.exit(1)
})
