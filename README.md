# Vidra

Vidra is an open-source desktop application for local video conversion and encoding. It combines a Tauri and Rust backend with a React interface and bundled FFmpeg tools.

The project currently targets macOS on Apple Silicon. Windows, Linux, and additional architectures will follow once the core workflow is stable.

Current capabilities:

- local media inspection with FFprobe;
- five content-adaptive H.264 quality levels;
- AAC stream copy when the source is already MP4-compatible;
- source-aware audio bitrate caps for required transcoding;
- live progress, cancellation, queue state, and session history;
- a fixed desktop interface with no browser-style page scrolling.

## Development

Requirements:

- Node.js 24 or later
- pnpm 11
- Rust and the Tauri system prerequisites
- macOS on Apple Silicon for the current FFmpeg bootstrap

Install dependencies and start the app:

```sh
pnpm install
pnpm tauri dev
```

The Tauri development command runs `pnpm ffmpeg:prepare` automatically. It downloads pinned development-only FFmpeg and FFprobe archives, verifies their SHA-256 checksums, extracts the executables, and ad-hoc signs them for local use.

## Checks

```sh
pnpm build
cargo fmt --manifest-path src-tauri/Cargo.toml --check
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml
```

## Licensing

Copyright (C) 2026 Mathieu Mafille.

Vidra is licensed under [GPL-3.0-or-later](LICENSE). See [COPYRIGHT](COPYRIGHT) for the application notice. FFmpeg and other dependencies retain their respective licenses; see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
