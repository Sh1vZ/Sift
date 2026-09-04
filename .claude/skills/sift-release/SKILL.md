---
name: sift-release
description: Use when shipping a Sift version — cutting a beta or stable release, bumping the version, writing the CHANGELOG section for it, tagging, or pushing the tag that triggers the release build.
---

<!-- Project-scoped instruction asset. Keep this file scoped to the Sift repository. -->

# Releasing Sift

A release is one tag. `.github/workflows/release.yml` fires on any `v*` tag, builds the
Windows installer, and publishes the GitHub release that installed copies update from.
Everything before the tag is `scripts/release.ts`, run as:

```bash
npm run release -- <beta|stable|patch|minor|major|x.y.z> [--dry-run] [--yes] [--no-push]
```

Your job around it is the part a script cannot do: choosing the version and writing the
changelog section that becomes the release body and the in-app "What's new".

## The flow

Work through these in order. Do not skip the dry run, and never push without the user
saying yes in chat.

### 1. Pick the version

Read `version` in `package.json` and decide with the user if it is not obvious from what
they asked:

| They want                       | Pass       | 1.0.0-beta.2 becomes |
| ------------------------------- | ---------- | -------------------- |
| The next beta                   | `beta`     | `1.0.0-beta.3`       |
| To settle the beta line         | `stable`   | `1.0.0`              |
| A bug-fix release from a stable | `patch`    | —                    |
| Features, from a stable         | `minor`    | —                    |
| Something specific              | `1.2.0-beta.1` |                  |

Going stable also means flipping `releaseType: prerelease` → `release` in
`electron-builder.yml` — the script refuses the release until that matches, because a
stable build never offers itself a prerelease and nobody would be updated.

### 2. Draft the CHANGELOG section

Read what has landed since the last release:

```bash
git log --oneline $(git describe --tags --abbrev=0)..HEAD
```

Then write the new section at the top of `CHANGELOG.md`, directly under the intro prose
and above the previous version:

```markdown
## [1.0.0-beta.3] - 2026-09-10

### Added

- One sentence on what the user can now do, then a sentence on what it means for them.
```

Rules, because this text ships three places (the GitHub release body, the notes beside a
pending update in Settings → About, and the one-time "What's new" after an update):

- **Write for the person running Sift, not the person who wrote the commit.** Describe the
  change from the outside: what appeared, what moved, what stopped happening.
- Match the voice of the sections already in `CHANGELOG.md` — full sentences, plain prose,
  second person for anything that affects the user's setup ("If either was your pick, Sift
  falls back to the default theme"). Bold names of UI surfaces and themes.
- Keep a Changelog headings only, in this order, omitting the empty ones: `### Added`,
  `### Changed`, `### Deprecated`, `### Removed`, `### Fixed`, `### Security`.
- Group by what the user sees, not by commit. Several commits building one feature are one
  bullet; one commit touching three features is three.
- Leave out anything with no user-visible effect — `refactor`, `test`, `ci`, `chore`,
  internal `build` work. A release whose commits are all internal gets a short prose line
  saying what it is (a rebuild, a dependency bump) rather than a padded list.
- Date the heading `YYYY-MM-DD` in the local timezone. The script warns if it is not today.
- Note anything the user has to redo themselves — a setting that resets, a folder that must
  be re-added, a shortcut that changed.
- No commit hashes, no PR numbers, no "various improvements".

Show the drafted section to the user and let them edit it before going on. This is the one
part of a release that cannot be corrected after the fact — the notes are baked into the
update manifest that shipped builds read.

### 3. Dry run

```bash
npm run release -- beta --dry-run
```

Changes nothing. It checks the branch, the working tree, that `origin/main` is not ahead,
that the tag is free, that the changelog section exists, and that the publish channel
matches the version. Fix whatever it names and run it again until it prints its plan.

### 4. Ship it

Ask the user to confirm the push explicitly — it starts the build and publishes a release
that installed copies will offer themselves. Only after they say yes:

```bash
npm run release -- beta --yes
```

That bumps `package.json` and `package-lock.json`, runs the typecheck and the tests, writes
`build/release-notes.md`, commits `chore(release): <version>`, creates the annotated tag,
and pushes both. It prints the Actions and release URLs when it is done.

If the user would rather push by hand, use `--no-push`: the script stops at the tag and
prints the push command.

### 5. Hand off

Give the user the two URLs the script printed and say what to look for: the run takes about
ten minutes, and the finished release must be a prerelease (not a draft) carrying
`Sift-<version>-setup.exe`, `latest.yml` and the `.blockmap`. A draft release is invisible
to `electron-updater`, so the app would report "up to date" forever.

Do not poll the run — `gh` is not installed on this machine. If the user wants CI watched,
say what it would take.

## When something goes wrong

| Symptom                                    | What it means                                                                              |
| ------------------------------------------ | ------------------------------------------------------------------------------------------ |
| Script refuses: tree has other changes     | Unrelated work is uncommitted. Commit or stash it — releases ship a reviewed tree.           |
| Script refuses: behind `origin/main`       | `git pull --ff-only` first, then re-draft the changelog if new commits deserve a bullet.     |
| Script refuses: no changelog section       | Step 2 was skipped or the heading version does not match exactly.                            |
| Script refuses: `releaseType` mismatch      | `electron-builder.yml` and the version disagree about prerelease. Fix, commit, re-run.       |
| CI fails on "Verify tag matches"           | The tag and `package.json` diverged. Only happens if a tag was made by hand.                 |
| CI fails on "Extract release notes"        | The changelog section is missing on the tagged commit.                                       |
| Workflow never starts                      | The tag was lightweight. `--follow-tags` only pushes annotated ones; the script always uses `-a`. |

Before the push, everything is local and reversible — the script prints the exact undo
commands when it fails partway. After the push it is not: deleting a published release and
its tag leaves anyone who already updated on a version that no longer exists. Prefer
shipping the next patch to unpublishing.
