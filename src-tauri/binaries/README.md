# FFmpeg sidecars

This directory is populated by `pnpm ffmpeg:prepare`.

Prepared executables are intentionally ignored by Git. Tauri expects each executable to use its Rust target triple, for example:

- `ffmpeg-aarch64-apple-darwin`
- `ffprobe-aarch64-apple-darwin`

The initial development manifest supports macOS on Apple Silicon. Release artifacts must be built from pinned source by Vidra's release pipeline before public distribution.
