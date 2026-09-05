# Changelog

All notable changes to Sift are recorded here. The section for each version becomes
that release's notes on GitHub and the "What's new" shown in the app after it updates.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and Sift
uses [semantic versioning](https://semver.org/spec/v2.0.0.html) — beta builds carry a
`-beta.N` suffix and update from the beta channel.

## [1.0.0-beta.6] - 2026-09-05

### Added

- **Per-track audio in the player.** ShadowPlay and OBS record the game and your mic
  as separate tracks, and until now only the one the file marked default was ever
  heard — so a mic you did not want was simply stuck in the clip. The player now
  lists every track and lets you solo one or mix them, each with its own volume and
  mute. Trim and export carry the choice through, so a clip exported with the mic
  silenced ships without it. Clips already in your library are re-examined in the
  background after this update so their tracks appear.

### Changed

- Favouriting is a heart rather than a star, on cards, in the player and in search.

### Fixed

- Clips are marked watched again when you play one through. Because the player opens
  in edit mode by default, the rule that stopped a looping trim preview from counting
  was skipping nearly every clip. Playing a full-length preview now counts as a
  watch, while looping a genuinely trimmed selection still does not.
- The sidebar's labels no longer jump out of place partway through a collapse. They
  hold while the column narrows and lead the way when it opens again.

## [1.0.0-beta.5] - 2026-09-05

### Added

- **Upload to YouTube.** Connect a Google Cloud project of your own under
  Settings → YouTube, then send any clip up from the player or its card menu. Sift
  follows the upload through Google's processing and tells you where it got to, and
  the clip keeps a link back to the video afterwards. The client ID and secret are
  stored encrypted on this PC and your sign-in is never saved. A project Google has
  not verified can only upload as private, and the pane says so before you start.
- **Copy file.** Copy a clip to the clipboard from a card or the details pane and
  paste it straight into Discord, Explorer, or anywhere else that takes a file.
- **An Activity panel.** The sidebar's Activity button lists every export, upload
  and scan in flight with its progress and a Cancel, and keeps a history of what has
  already finished so you can see what happened while you were away.
- **Ctrl+K searches every clip** from anywhere in the app, not just the one you are
  looking at. `/` still focuses whichever box is on screen.
- **Favourites and unwatched.** Star a clip from its card or the player, and Sift
  marks one seen once you have watched it through. Both are filters in the toolbar.
- **Renaming and merging games.** Give a game the name you actually call it, and
  fold two folders into one when a recorder has written the same game twice. Sift
  points out pairs that look like duplicates and offers to merge them or keep them
  separate; a merge can be undone later.
- **Drag a folder onto the window** to add it, on the Games screen or in
  Settings → Folders.
- **A Clear previews action** in Settings → Storage. It removes every cached poster
  and scrub strip, says how many files went, and rebuilds them in the background.
- **A shortcuts dialog** on `?`, and Backspace, Alt+← or Esc now go back from every
  screen rather than only inside a game.

### Changed

- **The sidebar is labelled by default**, with names and counts. Ctrl+B or the
  chevron at the bottom collapses it to the old icon rail, and it collapses on its
  own on a narrow window so the grid keeps its columns.
- **Every screen shares one header and one toolbar** — a title row with the figures
  and the main action, over a row that filters by name, favourites and unwatched,
  sorts, and tucks grouping and card size into a View menu. Filters are remembered
  per screen, so narrowing one game no longer narrows the Clips view.
- **Cards carry their own actions.** The favourite star and a menu sit on every clip
  and game card at rest, so nothing needs the details pane or a right-click.
- **The player shows an export on the stage** from queued to done, with Cancel while
  it runs and View clip when it lands. The trim row now says in words why Export is
  off — "Give the clip a name", "Selection is too short" — instead of just dimming.
- **Settings panes start at the first control** instead of a centred hero, row
  actions are labelled buttons with the destructive one held apart, and the search
  matches individual settings and scrolls to the row it found. Info opens the
  bundled changelog in the app.
- **Storage reports the whole volume**, not just Sift's own folders, and suggests
  what is worth clearing — recordings you have already trimmed, and the preview cache.
- **Text and controls are bigger.** The base size goes to 15px and buttons, inputs
  and selects settle at a consistent 40px, so the app reads at a glance.
- **The app icon follows your theme**, in the taskbar and the tray.

### Fixed

- Card posters are cut from the clip's first frame, so the thumbnail, the hover flip
  and the first frame of playback are finally the same picture.
- Opening the first clip of a session no longer freezes the window for a moment. The
  video shaders are compiled behind the splash screen while Sift starts instead.
- Sift stops scanning, drawing and decoding while its window is hidden or minimised,
  so it costs nothing in the background.

## [1.0.0-beta.4] - 2026-09-03

### Added

- The "What's new" dialog gained a **Full changelog** tab. It lists every release
  Sift has shipped, newest first, with the version you are running marked
  **Installed**. The rest of the history is only read when you open that tab.

### Changed

- Release notes now keep their formatting. Bold text, links, code and nested
  bullets are drawn as written instead of arriving as one plain block of text.
- The **OLED** themes no longer paint the two coloured washes across the canvas.
  Over a true-black ground the fade ran out mid-screen and read as a hard grey arc
  in the corner rather than a glow, so the ground is now black all the way out and
  the colour stays in the lit parts of the interface.

## [1.0.0-beta.3] - 2026-09-03

### Fixed

- Sift can find its updates again. The previous build was published as two releases
  sharing one tag with its files split between them, so the app had nothing to read
  and Settings → About reported "No update feed for this build yet". If your copy is
  still saying that, install this version by hand once — every check after it works
  on its own.

## [1.0.0-beta.2] - 2026-09-03

### Added

- Three new themes. **Nox** is a deep plum canvas with a magenta identity and amber
  punctuation; **Grim** is a near-black forest ground with a sage identity and
  terracotta punctuation; **Space** is a deep-space navy with a cosmic blue identity
  and starlight gold punctuation.

### Removed

- The Arctic and Verdant themes. If either was your pick, Sift falls back to the
  default theme the next time it starts, and you can choose a new one in
  Settings → Themes.

## [1.0.0-beta.1] - 2026-09-03

The first public beta.

### Added

- Sift now updates itself. It checks for a new beta in the background, downloads it
  quietly, and shows a "Restart to update" pill in the title bar when one is ready.
- Settings → About gained an Updates section: the current status, the notes for a
  pending version, a "Check now" button, and a switch to turn automatic checks off.
