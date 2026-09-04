# Changelog

All notable changes to Sift are recorded here. The section for each version becomes
that release's notes on GitHub and the "What's new" shown in the app after it updates.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and Sift
uses [semantic versioning](https://semver.org/spec/v2.0.0.html) — beta builds carry a
`-beta.N` suffix and update from the beta channel.

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
