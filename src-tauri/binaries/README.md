# FFmpeg sidecars

This directory is populated by `pnpm ffmpeg:prepare`.

Prepared executables are intentionally ignored by Git. Each sidecar is named `<name>-<target-triple>`:

- `ffmpeg-aarch64-apple-darwin`
- `ffprobe-aarch64-apple-darwin`

They come from the engine archive pinned in `scripts/ffmpeg/engine.json`, which development, CI, and the release all install. A hidden `.ffmpeg-engine-<target>.sha256` file records which engine is installed. Other targets fail with an unsupported-target error until an engine is pinned for them. See "The FFmpeg engine" in `docs/RELEASING.md`.
