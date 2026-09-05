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
- dav1d, licensed under the BSD 2-Clause License (full notice below);
- Opus, licensed under the BSD 3-Clause License;
- zimg, licensed under the Do What The Fuck You Want To Public License version 2.

The default local development bootstrap still uses artifacts from [OSXExperts](https://www.osxexperts.net/). Those artifacts are development-only, are not committed, and must not be used for a public Vidra release.

See [FFmpeg's legal and license documentation](https://ffmpeg.org/legal.html).

### dav1d

dav1d provides software AV1 decoding. Its source archive is included with every release.

```text
Copyright © 2018-2025, VideoLAN and dav1d authors
All rights reserved.

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright notice, this
   list of conditions and the following disclaimer.

2. Redistributions in binary form must reproduce the above copyright notice,
   this list of conditions and the following disclaimer in the documentation
   and/or other materials provided with the distribution.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND
ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT OWNER OR CONTRIBUTORS BE LIABLE FOR
ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES
(INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES;
LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND
ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
(INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS
SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
```

## Tauri

Vidra uses [Tauri](https://tauri.app/) and its official plugins. Tauri is dual-licensed under the Apache License 2.0 and the MIT License.

## React

Vidra uses [React](https://react.dev/), licensed under the MIT License.

## Lucide

Vidra uses icons from [Lucide](https://lucide.dev/) through the `lucide-react` package.
Lucide is licensed under the ISC License.
