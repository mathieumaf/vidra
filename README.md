# Vidra

Vidra is an open-source desktop application for local video conversion and encoding. It combines a Tauri and Rust backend with a React interface and bundled FFmpeg tools.

## Project status

> [!WARNING]
> Vidra is prerelease software. There are no stable releases yet; features, encoding profiles, and file compatibility may change. Beta builds are intended for testing, and users should always keep the original copy of important media.

The project currently targets macOS on Apple Silicon. Windows, Linux, and additional architectures will follow once the core workflow is stable.

Current capabilities:

- local media inspection with FFprobe;
- HDR, color-space, color-range, and bit-depth inspection with re-encoding risk warnings;
- multi-file selection and native drag and drop;
- MP4 and MKV output with H.264 or H.265 video;
- AV1 software encoding in MKV;
- orientation-aware output resolution limits from 360p to 4K without upscaling;
- an optional advanced mode for frame rate, fine quality, audio, track, and source-information controls;
- built-in and personal encoding profiles stored locally on the device;
- five codec-aware quality levels;
- lossless audio stream copy when the selected container supports it;
- source-aware audio bitrate caps for required transcoding;
- MKV subtitle, chapter, and metadata preservation;
- a sequential batch queue with reordering, pending-job removal, pause and resume, and current-job cancellation;
- new videos can be prepared and appended while another job is running;
- per-job progress with ETA and persistent local conversion history;
- structured, path-redacted FFmpeg diagnostic reports that can be copied or saved after failures;
- a fixed desktop interface with no browser-style page scrolling.

## Installation

Beta installers will be published on the [GitHub Releases page](https://github.com/mathieumaf/vidra/releases). Download the Apple Silicon DMG and its SHA-256 checksum, verify the checksum, then move Vidra to the Applications folder. Only signed and notarized release artifacts are intended for distribution.

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

See [CONTRIBUTING.md](CONTRIBUTING.md) before opening a pull request.

## Licensing

Copyright (C) 2026 Mathieu Mafille.

Vidra is licensed under [GPL-3.0-or-later](LICENSE). See [COPYRIGHT](COPYRIGHT) for the application notice. FFmpeg and other dependencies retain their respective licenses; see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
