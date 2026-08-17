# Changelog

All notable changes to Vidra are documented in this file.

## Unreleased

### Added

- Add automatic, light, and dark appearance modes, follow system theme changes live by default, and remember explicit theme choices.
- Estimate how much destination space a conversion needs, warn before queuing when a volume may not have enough room, and let the user proceed anyway.
- Offer to restore or discard the waiting queue after a restart, keep the saved conversion settings, and explain sources that can no longer be read, without starting encoding.

### Changed

- Keep compatible text subtitle tracks in MP4 output by converting them to MP4 text, warn when ASS styling will be lost, and exclude image-based subtitle tracks from MP4.
- Show animated activity with elapsed time, processed time, and frame count when the source duration is unknown, instead of a percentage or ETA.

### Fixed

- Open a native confirmation dialog before clearing conversion history, and only remove entries after the user confirms.

## 0.1.0-beta.4 - 2026-08-14

### Added

- Add signed application updates with automatic release checks, an in-app install prompt, and conversion-safe installation.
- Show the running Vidra and FFmpeg versions, exact release and source links, GPL license, and third-party notices in Settings.

### Changed

- Allow AV1 video in MP4 output, tagged as `av01` alongside the existing faststart behavior.
- Automatically tone map HDR sources to BT.709 SDR for H.264, preserve 10-bit HDR and color tags for H.265 and AV1, and require stream copy for unsupported Dolby Vision structures.

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
