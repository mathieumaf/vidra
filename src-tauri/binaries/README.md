# FFmpeg sidecars

This directory is populated by `pnpm ffmpeg:prepare`.

Prepared executables are intentionally ignored by Git. Each sidecar is named `<name>-<target-triple>`:

- `ffmpeg-aarch64-apple-darwin`
- `ffprobe-aarch64-apple-darwin`

macOS on Apple Silicon downloads the archive pinned in `scripts/ffmpeg/dev-archive.json`, at the same FFmpeg version as the release recipe in `scripts/ffmpeg/sources.json`. Other targets fail with an unsupported-target error until a pinned sidecar is added. The app treats an engine as ready only when both tools report the pinned release version.

Release artifacts must be built from pinned source by Vidra's release pipeline before public distribution. The development archive is not a substitute for that pipeline.
