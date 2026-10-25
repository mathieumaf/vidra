# FFmpeg sidecars

This directory is populated by `pnpm ffmpeg:prepare`.

Prepared executables are intentionally ignored by Git. Tauri expects each executable to use its Rust target triple, for example:

- `ffmpeg-aarch64-apple-darwin`
- `ffprobe-aarch64-apple-darwin`
- `ffmpeg-x86_64-unknown-linux-gnu`
- `ffprobe-x86_64-unknown-linux-gnu`

The development manifest in `scripts/ffmpeg/sources.json` is keyed by target triple. It currently pins macOS on Apple Silicon. Other targets fail with an unsupported-target error until a pinned sidecar is added. For local development and CI only, `VIDRA_FFMPEG_DIR` can supply `ffmpeg` and `ffprobe`; those copies are not release artifacts.

Release artifacts must be built from pinned source by Vidra's release pipeline before public distribution.
