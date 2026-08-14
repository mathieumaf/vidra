# Changelog

All notable changes to Vidra are documented in this file.

## Unreleased

### Changed

- Allow AV1 video in MP4 output, tagged as `av01` alongside the existing faststart behavior.

### Fixed

- Keep H.264 output at 8-bit 4:2:0 on both encoding speeds so converted files stay hardware decodable, and normalize output chroma to 4:2:0 while H.265 and AV1 keep a 10-bit source at 10 bits.
- Number batch output names, and show them in the queue, instead of silently replacing files that already exist in the destination folder.
- Replace the blank window a failed interface used to leave with a recoverable failure state that keeps the queue, says whether a conversion is still running, and offers a copyable diagnostic report.
- Report uncaught interface errors and unhandled promise rejections in the window instead of losing them in the webview console.

## 0.1.0-beta.3 - 2026-07-18

### Added

- Local-first video inspection and conversion for macOS on Apple Silicon.
- H.264, H.265, and AV1 software and VideoToolbox encoding paths.
- Sequential conversion queue, cancellation, pause and resume, profiles, history, and diagnostic reports.
- Reproducible GPL-enabled FFmpeg release builds from pinned source archives.
- Automated validation and signed, notarized draft-release workflows.

### Fixed

- Build FFmpeg sidecars exclusively against macOS system libraries so release builds run without Homebrew.
- Protect every selected input from output path aliases, symbolic links, and hard-link collisions.
- Clean up active conversion processes and incomplete outputs during application shutdown.
- Show completed job status without also displaying a stale waiting message.
