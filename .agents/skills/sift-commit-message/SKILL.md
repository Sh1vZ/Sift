---
name: sift-commit-message
description: Use when generating commit messages for Sift; enforces required-scope Conventional Commits with scopes drawn from the Electron main / preload / renderer / shared layout.
---

<!-- Project-scoped instruction asset. Keep this file scoped to the Sift repository. -->

# Git Commit Message Instructions

Follow these rules strictly when generating commit messages for this repository.
Sift ships as a versioned Windows installer, so the history must stay
machine-parseable and consistent enough to generate a changelog from.

> **Note:** this working tree is not a git repository yet. Run `git init` before the
> first commit. These rules apply from the first commit onward.

## Format

Use the [Conventional Commits 1.0.0](https://www.conventionalcommits.org/en/v1.0.0/)
specification with a **mandatory scope**:

```
<type>(<scope>): <subject>

[optional body]

[optional footer(s)]
```

Example:

```
feat(player): add autoplay-next through the current grid order
```

## Hard Rules

1. **Header line <= 100 characters** (type + scope + subject combined). Never exceed.
2. **Scope is required** and written in lowercase inside parentheses: `fix(grid):`, never `fix:`.
3. **Subject** is written in **imperative, present tense**: "add", "fix", "remove" — not "added", "adds", "fixing".
4. **Do not capitalize** the first letter of the subject.
5. **No trailing period** on the subject line.
6. Separate header, body, and footer with a single blank line.
7. Wrap body lines at ~100 characters. Use the body to explain _what_ and _why_, not _how_.
8. Use English only.

## Allowed Types

| Type       | When to use                                              | Triggers release |
| ---------- | -------------------------------------------------------- | ---------------- |
| `feat`     | A new user-facing feature                                | minor            |
| `fix`      | A bug fix                                                | patch            |
| `perf`     | A performance improvement                                | patch            |
| `refactor` | Code change that neither fixes a bug nor adds a feature  | none             |
| `docs`     | Documentation only changes (README, design-system notes) | none             |
| `style`    | Formatting, whitespace (no code change)                  | none             |
| `test`     | Adding or correcting tests                               | none             |
| `build`    | electron-vite / electron-builder config, manifests       | none             |
| `ci`       | CI configuration                                         | none             |
| `chore`    | Maintenance tasks that don't fit elsewhere               | none             |
| `revert`   | Reverts a previous commit                                | depends          |

## Scope Guidelines

The scope identifies the **module/area** being changed, named after the folder or file
that owns the behaviour. Always provide one — never omit the parentheses.

### Main-process scopes (`src/main/`)

- `main` — `src/main/index.ts`, app lifecycle, single-instance lock, Chromium switches
- `ipc` — `src/main/ipc.ts` handler surface
- `library` — `lib/library.ts`, the in-memory clip index and event fan-out
- `scanner` — `lib/scanner.ts` folder walking
- `media` — `lib/media.ts`, ffprobe/ffmpeg jobs, thumbnails, sprite strips, the job queue
- `exports` — `lib/exports.ts` and the export chain in `library.ts` (stream-copy trims, the clips folder)
- `watcher` — `lib/watcher.ts` chokidar watchers
- `store` — `lib/store.ts` persisted settings and folder list
- `protocol` — `lib/protocol.ts`, the `clip://` scheme and range streaming
- `paths` — `lib/paths.ts`, cache dirs, bundled ffmpeg resolution
- `window` — `lib/window.ts`, BrowserWindow creation and frame
- `youtube` — `lib/youtube/*` (OAuth, the Data API wrapper, resumable uploads, the quota ledger,
  the upload queue) and the YouTube UI (`useYouTube`, `useUploads`, `UploadDialog.vue`,
  `QuotaMeter.vue`, `YouTubePane.vue`)

### Bridge and shared scopes

- `preload` — `src/preload/index.ts`, the `window.api` contextBridge surface
- `shared` — `src/shared/types.ts` and `src/shared/api.ts`

### Renderer scopes (`src/renderer/`)

Use the component, view, or composable that owns the change:

- `app` — `App.vue`, `main.ts`, renderer bootstrap
- `library-view`, `games`, `folders` — the three top-level screens
- `clips` — `ClipsView.vue`, the recordings/exports partition in `useLibrary`, `useExports`
- `player` — `PlayerOverlay.vue`, `PlayerDetails.vue` and `usePlayer`
- `editor` — the player's trim/export edit mode: `useEditor.ts`, `TrimBar.vue`
- `settings` — `SettingsView.vue`, `useSettings.ts` and the panes under `components/settings/`
- `grid` — `ClipGrid.vue` and `useVirtualGrid`
- `card` — `ClipCard.vue`
- `sidebar`, `titlebar` — shared chrome
- `toasts` — `useToasts.ts` and `ToastBridge.vue`
- `dialogs` — `useDialogs.ts` and `DialogHost.vue`
- `bits` — anything under `components/bits/` (Vue Bits copies)
- `icons` — `Icon.vue` and its inline Lucide set
- `composables` — cross-cutting composable changes with no single view owner
- `styles` — `tokens.css`, `base.css`, `tailwind.css`
- `nuxt-ui` — Nuxt UI plugin config, the `--ui-*` theme bridge, or component adoption
- `motion` — `useMotion.ts` and shared animation presets

### Cross-cutting scopes

- `design-system` — `design-system/sift/MASTER.md` and page overrides
- `deps` — dependency upgrades
- `build` — `electron.vite.config.ts`, `electron-builder.yml`, tsconfigs
- `release` — release commits
- `repo` — repository-wide changes (root configs, `.claude/`, `.agents/`, editor config)

If a change truly spans many modules, pick the most representative scope rather than
inventing multi-scope syntax. Do not use `*`, `all`, or comma-separated scopes.

## Breaking Changes

The IPC channel names, the `window.api` shape, the `EventMap` payloads, and the
persisted store schema are contracts across the three processes. Changing any of
them is breaking. For a breaking change, do **both**:

1. Append `!` after the scope: `feat(shared)!: replace clip.recordedAtMs with an ISO string`
2. Add a `BREAKING CHANGE:` footer explaining the migration path:

```
feat(shared)!: replace clip.recordedAtMs with an ISO string

BREAKING CHANGE: Clip.recordedAtMs is now Clip.recordedAt, an ISO 8601 string.
The persisted store is migrated on first launch; renderer sorting helpers must
parse before comparing.
```

## Footers

Use Git trailer format (`Token: value`). Common footers:

- `BREAKING CHANGE: <description>`
- `Closes: #123`, `Fixes: #123`, `Refs: #123`
- `Co-authored-by: Name <email>`

## Examples

Good:

```
feat(games): add fuzzy search that ignores punctuation in game names
feat(nuxt-ui): re-point the --ui-* variables at the app palette
fix(toasts): forward queued toasts through ToastBridge instead of dropping them
fix(protocol): tear down the read stream when Chromium abandons a range request
perf(grid): window section rows so a 5,000-clip library renders like 50
perf(media): seek keyframes for sprite strips instead of decoding whole files
refactor(composables): move date bucketing out of useLibrary into utils/format
docs(repo): document the clip:// range protocol in the README
build(deps): bump electron from 44.1.0 to 44.1.1
chore(repo): add project-scoped agent skills under .claude/skills
revert(player): revert "feat(player): add frame-step shortcuts"
feat(preload)!: rename window.api.clips.reveal to showInFolder
```

Bad (do not produce these):

```
Added hover previews                  # missing type and scope
feat: add thing                       # missing scope
Feat(player): Added autoplay next.    # capitalized type/subject, past tense, trailing period
feat(player, grid): ...               # multiple scopes not allowed
fix(stuff): various fixes             # meaningless scope and subject
```

## When Generating Commits

- Inspect the staged diff to pick the **single most accurate type and scope**.
- A change that crosses `main` → `preload` → `renderer` to deliver one feature is one
  commit; scope it to the layer that owns the feature, not to `shared`.
- If multiple unrelated changes are staged, suggest splitting them into separate commits.
- Keep the subject focused on _what changed for the user/developer_, not the file paths.
- Only include a body when the _why_ is non-obvious from the subject — a `perf` commit
  should say what the measurable win was.
- Header must not be longer than **100 characters**.
