# Changelog

All notable changes to Vidra are documented in this file.

## 0.1.0 - Unreleased

### Fixed

- Decode AV1 input in software with bundled dav1d, allowing conversion on Apple Silicon Macs without relying on a hardware AV1 decoder.
- Verify software AV1 decoding and re-encoding for 8-bit and 10-bit MP4/MKV inputs during release engine preparation.

### Release scope

- Prepare the first official release for macOS on Apple Silicon, building on the validated 0.1.0 prereleases. Windows, Linux, and Intel Mac builds are not included.
- Carry forward local video inspection, MP4 and MKV conversion with H.264, H.265, and AV1, compatible audio preservation, HDR handling, encoding profiles, and a sequential conversion queue.
- Include Finder Open With, appearance preferences, queue restoration, destination-space estimates, conversion history, diagnostic reports, and signed application updates introduced during the beta series.
- Keep all media processing on the device and preserve source files.

This release is in preparation. Artifact verification and publication are tracked in [the 0.1.0 release checklist](docs/RELEASE-0.1.0.md). The sections below retain the detailed beta release history.

## 0.1.0-beta.6 - 2026-09-05

### Added

- Add an Update channel choice in Settings. Stable is the default and offers official releases only; Beta also offers newer prereleases, including release candidates.
- Remember the selected channel across restarts and use it for both automatic and manual update checks.

### Changed

- Check the selected channel again before installation, reject prereleases on Stable, and only offer newer versions. Switching back to Stable keeps the installed version until a newer official release is available.
- Clear available updates when switching channels, ignore late responses from the previous channel, and prevent channel changes during installation.
- Publish separate Stable and Beta update manifests. Older releases and stable hotfixes no longer replace a newer version already offered on a channel.
- Update `tauri-plugin-shell` from 2.3.5 to 2.3.6.
- Define the 0.x release policy and the core workflow and platform criteria for 1.0.

### Installation and testing

- This prerelease targets macOS on Apple Silicon. Windows, Linux, and Intel Mac installers are not included.
- Install the beta.6 DMG manually when upgrading from beta.5 or earlier. The beta.5 updater uses the legacy update feed, which is now reserved for official releases and will not advertise beta.6.
- Choose Beta in Settings to receive future test builds. Selecting Beta does not reinstall beta.6 when it is already installed.
- Validate the signed beta.6 installer and both channel choices before the next release candidate. A later `0.1.0-rc.1` will let beta.6 users test an actual update on Beta while Stable ignores that prerelease. See the [prerelease validation checklist](docs/RELEASE-0.1.0.md#prerelease-validation).

## 0.1.0-beta.5 - 2026-09-04

### Added

- Open supported videos from Finder with Open With: Vidra launches with the file ready to convert, or appends it to the current selection without disturbing a running conversion.
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
