# Vidra

Vidra is an open-source desktop application for local video conversion and encoding. It combines a Tauri and Rust backend with a React interface and bundled FFmpeg tools.

## Project status

Vidra is preparing **0.1.0**, its first official release for **macOS on Apple Silicon**. Until it is published, the available downloads are prerelease builds intended for testing.

The 0.x series will develop and refine the core conversion workflow. Windows and Linux are planned; they are not supported by the current release builds. Version 1.0 will mark a reliable core workflow across macOS, Windows, and Linux. See the [roadmap](docs/ROADMAP.md) for the release milestones and acceptance criteria.

Keep the original copy of important media. Vidra preserves source files, and features, encoding profiles, and file compatibility may evolve during 0.x development.

Current capabilities:

- local media inspection with FFprobe;
- HDR, color-space, color-range, and bit-depth inspection with automatic HDR-to-SDR tone mapping or HDR preservation;
- multi-file selection, native drag and drop, and Finder Open With;
- MP4 and MKV output with H.264, H.265, or AV1 video;
- AV1 software encoding in either container, with an explicit `av01` tag for MP4;
- orientation-aware output resolution limits from 360p to 4K without upscaling;
- an optional advanced mode for frame rate, fine quality, audio, track, and source-information controls;
- built-in and personal encoding profiles stored locally on the device;
- five codec-aware quality levels;
- lossless audio stream copy when the selected container supports it;
- source-aware audio bitrate caps for required transcoding;
- MKV subtitle, chapter, and metadata preservation;
- a sequential batch queue with reordering, pending-job removal, pause and resume, and current-job cancellation;
- numbered batch output names that never replace files already present in the destination folder;
- new videos can be prepared and appended while another job is running;
- per-job progress with ETA and persistent local conversion history;
- structured, path-redacted FFmpeg diagnostic reports that can be copied or saved after failures;
- application and FFmpeg version details, source and release links, and in-app third-party notices;
- a fixed desktop interface with no browser-style page scrolling.

## Installation

Installers are available on the [GitHub Releases page](https://github.com/mathieumaf/vidra/releases). Until 0.1.0 is published, choose a beta or release candidate only if you want to test Vidra. Download the Apple Silicon DMG and its SHA-256 checksum, verify the checksum, then move Vidra to the Applications folder. Only signed and notarized release artifacts are intended for distribution.

Starting with 0.1.0-beta.6, Settings includes an **Update channel** choice. **Stable** is the default and offers official releases only. **Beta** also offers newer test builds, including release candidates. The choice is saved locally and applies to automatic and manual checks. Switching back to Stable keeps the installed version until a newer official release is available; it does not downgrade the app.

## Privacy

Vidra processes media locally. It has no accounts, uploads, telemetry, or network-based conversion, and it never modifies or deletes source media.

## Development

Requirements:

- Node.js 24 or later
- pnpm 11
- Rust and the Tauri system prerequisites
- macOS on Apple Silicon for the current FFmpeg bootstrap
- Xcode 26 or later to regenerate the layered macOS icon

Install dependencies and start the app:

```sh
pnpm install
pnpm tauri dev
```

The Tauri development command prepares both native assets automatically. `pnpm icon:prepare` compiles the Icon Composer document when Xcode is available and otherwise uses the checked-in fallback assets. `pnpm ffmpeg:prepare` downloads pinned development-only FFmpeg and FFprobe archives, verifies their SHA-256 checksums, extracts the executables, and ad-hoc signs them for local use.

## Checks

```sh
pnpm check
```

Public macOS builds use a separate, pinned FFmpeg source build and Apple signing and notarization. See [docs/RELEASING.md](docs/RELEASING.md) for the release process.

Vidra's codec-specific HDR behavior is documented in [docs/HDR_POLICY.md](docs/HDR_POLICY.md).

See [CONTRIBUTING.md](CONTRIBUTING.md) before opening a pull request.

## Licensing

Copyright (C) 2026 Mathieu Mafille.

Vidra is licensed under [GPL-3.0-or-later](LICENSE). See [COPYRIGHT](COPYRIGHT) for the application notice. FFmpeg and other dependencies retain their respective licenses; see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
