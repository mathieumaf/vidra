# Third-party notices

This document describes the principal third-party components distributed with Vidra. The complete dependency graphs and exact resolved versions are recorded in `pnpm-lock.yaml` and `src-tauri/Cargo.lock`.

## FFmpeg

Vidra uses FFmpeg and FFprobe for media inspection and conversion.

FFmpeg is licensed under the GNU Lesser General Public License 2.1 or later by default. Builds that include optional GPL components, including libx264 and libx265, are covered by the applicable GNU General Public License terms. Vidra is licensed under GPL-3.0-or-later to support GPL-enabled FFmpeg builds.

Public macOS Apple Silicon releases use FFmpeg and FFprobe built by Vidra from the source versions and SHA-256 checksums pinned in `scripts/ffmpeg/sources.json`. The exact corresponding source archives, checksum manifest, and build configuration are attached to every GitHub release.

The release build currently links these optional libraries statically:

- x264, licensed under GPL version 2 or later;
- x265, licensed under GPL version 2 or later;
- SVT-AV1, licensed under the BSD 3-Clause License;
- Opus, licensed under the BSD 3-Clause License.

The default local development bootstrap still uses artifacts from [OSXExperts](https://www.osxexperts.net/). Those artifacts are development-only, are not committed, and must not be used for a public Vidra release.

See [FFmpeg's legal and license documentation](https://ffmpeg.org/legal.html).

## Tauri

Vidra uses [Tauri](https://tauri.app/) and its official plugins. Tauri is dual-licensed under the Apache License 2.0 and the MIT License.

## React

Vidra uses [React](https://react.dev/), licensed under the MIT License.

## Lucide

Vidra uses icons from [Lucide](https://lucide.dev/) through the `lucide-react` package.
Lucide is licensed under the ISC License.
