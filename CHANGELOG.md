# Changelog

All notable changes to Vidra are documented in this file.

## Unreleased

## 0.1.0-beta.1 - 2026-07-18

### Added

- Local-first video inspection and conversion for macOS on Apple Silicon.
- H.264, H.265, and AV1 software and VideoToolbox encoding paths.
- Sequential conversion queue, cancellation, pause and resume, profiles, history, and diagnostic reports.
- Reproducible GPL-enabled FFmpeg release builds from pinned source archives.
- Automated validation and signed, notarized draft-release workflows.

### Fixed

- Protect every selected input from output path aliases, symbolic links, and hard-link collisions.
- Clean up active conversion processes and incomplete outputs during application shutdown.
- Show completed job status without also displaying a stale waiting message.
