# Changelog

All notable changes to Vidra are documented in this file.

## Unreleased

Intended prerelease **0.2.0-beta.1** for macOS on Apple Silicon. The application bundle version is `0.2.0`. The updater version is the full tag `v0.2.0-beta.1`. Before tagging, replace this heading with `0.2.0-beta.1` and the release date. Windows, Linux, and Intel Mac builds are not included.

### Fixed

- Leave an existing destination file in place when a conversion fails, is cancelled, or Vidra quits. An existing destination file is replaced only after explicit confirmation and a successful conversion, and only when that same file is still there.
- Keep a destination that appears after the output name is checked. FFmpeg writes a hidden partial file beside the destination and never receives the final path. The finished video is published with an exclusive rename. When that name is taken, Vidra saves the video under the next free numbered name instead of deleting it, and says which name it used.
- Keep a finished video that cannot be moved into place, and say where it was saved. The next launch removes only unfinished partials Vidra recorded. A finished video that has been marked as saved is not deleted, including after Vidra is killed and opened again.
- Save a finished video on volumes that cannot rename without replacing, including exFAT, FAT32, and SMB. The destination is checked and then renamed; that check has a very small race.
- Say when the destination folder is read-only. A permission or privacy denial uses a different message and is not described as a read-only volume.
- Convert MOV text subtitles to SubRip when saving MKV. Matroska cannot store MOV text, so copying that track failed the conversion. Other MKV subtitle tracks are still copied.
- Drop mastering-display, content-light, and HDR10+ metadata when H.264 tone-maps HDR to SDR. FFmpeg 8 was copying that metadata onto the SDR file, so Vidra still treated the result as HDR. H.265 and AV1 re-encodes still keep mastering-display and content-light metadata on the video stream.

### Changed

- Require free space for the new file while a confirmed replacement is encoding. The existing file stays on disk until the conversion succeeds, so its space is not treated as available.
- Build the Apple Silicon release engine from FFmpeg 8.1.3. This security and bugfix update is an intentional release-recipe change, so the recipe fingerprint changed. A new beta or release candidate has to re-validate the engine before an official release. When the pinned engine is ready, Settings shows an FFmpeg version line that includes 8.1.3.
- Report the encoding engine as unavailable unless FFmpeg and FFprobe both report 8.1.3. A development copy of a different version can still be used to compile Vidra, and the app explains that it is not the release engine.

### Installation and testing

- This prerelease targets macOS on Apple Silicon. Windows, Linux, and Intel Mac installers are not included.
- From an installed 0.1.0, choose Beta in Settings and check for updates. Stable does not offer this prerelease. The bundle version shown in Settings is 0.2.0; the release link is `v0.2.0-beta.1`.
- Signed-build checks are listed in the [beta validation checklist](docs/RELEASING.md#beta-validation).

### Internal

- Prepare other operating systems to fail closed. Where a check is not implemented, Vidra returns `unsupported_platform` for file identity, destination disk space, saving a converted video, showing the output file, and fast hardware encoding. Preventing sleep returns `sleep_prevention_unsupported`. Pausing an encode returns `pause_unsupported` off Unix. macOS behavior is unchanged. This beta does not add a Windows or Linux release.
- Keep the macOS sentences "this Mac" and "Files stay on this Mac". Other hosts say "this computer".
- Download the Apple Silicon development sidecar from the checksum-pinned archive on tag `ffmpeg-dev-8.1.3-r6`, built with the same recipe as the release engine. `pnpm ffmpeg:prepare` does not compile FFmpeg. Compiling locally requires `pnpm ffmpeg:prepare -- --build`. `VIDRA_FFMPEG_DIR` is for development and CI only, and release builds reject it.
- Check Rust licenses, advisories, and crate sources with cargo-deny on every pull request. Duplicate crate versions are warnings. That change records rustls-webpki 0.103.16 for RUSTSEC-2026-0382. The lockfile has rustls 0.23.46.
- Cache the Apple Silicon CI build and the development FFmpeg archive. Run the portable frontend and Rust checks on Ubuntu 24.04, using a system FFmpeg only as a development sidecar.
- Cover enqueue, launch, finish, cancel, pause, reorder, and shutdown in queue tests without starting a sidecar. A poisoned queue lock is recovered so shutdown can still stop the encoder and remove its unfinished partial file.
- Encode a reduced synthetic corpus in Apple Silicon CI with the pinned sidecar. The corpus includes H.264, H.265, and AV1, MP4 and MKV, HDR10 and HLG sources, and MOV text subtitles. H.264 output from those HDR sources must not still be classified as HDR. H.265 and AV1 keep 10-bit HDR. For the HDR10 clip, the macOS sidecar must keep stream-level mastering-display and content-light metadata through those re-encodes. Source files stay unchanged. The Linux job runs the same corpus as a smoke test against an older system FFmpeg and does not require the release encoders.
- Update locked JavaScript and Rust dependencies, including the Tauri plugins, React 19.3.1, and Vite 8.3.4. These updates are not a separate conversion-behavior change.

## 0.1.0 - 2026-09-05

### Release scope

- Ship the first official release for macOS on Apple Silicon, building on the validated 0.1.0 prereleases. Windows, Linux, and Intel Mac builds are not included.
- Carry forward local video inspection, MP4 and MKV conversion with H.264, H.265, and AV1, compatible audio preservation, HDR handling, encoding profiles, and a sequential conversion queue.
- Include Finder Open With, appearance preferences, queue restoration, destination-space estimates, conversion history, diagnostic reports, and signed application updates introduced during the beta series.
- Keep all media processing on the device and preserve source files.

### Updates and compatibility

- Offer official releases on the default Stable update channel and newer test builds on the opt-in Beta channel. Both channels offer 0.1.0 to earlier 0.1.0 prereleases.
- Decode AV1 input in software with bundled dav1d, including 8-bit and 10-bit sources, without requiring hardware AV1 decoding.
- Distribute signed and notarized macOS Apple Silicon installers, signed updates, checksums, and the corresponding FFmpeg and codec sources.

### Installation

- Download the Apple Silicon DMG from this release, or check for updates in an installed beta or release candidate. Beta.5 uses the legacy feed; beta.6 and rc.1 can use either Stable or Beta to receive 0.1.0.
- Windows, Linux, and Intel Mac installers are not included. The 0.x series continues to develop the core app; the multiplatform 1.0 milestone is documented in the roadmap.

The sections below retain the detailed prerelease history. Artifact and updater validation are tracked in [the 0.1.0 release checklist](docs/RELEASE-0.1.0.md).

## 0.1.0-rc.1 - 2026-09-05

### Fixed

- Decode AV1 input in software with bundled dav1d, allowing conversion on Apple Silicon Macs without relying on a hardware AV1 decoder.
- Verify software AV1 decoding and re-encoding for 8-bit and 10-bit MP4/MKV inputs during release engine preparation.

### Changed

- Include the full dav1d license with the application and list the decoder in third-party notices.

### Installation and testing

- This release candidate targets macOS on Apple Silicon. Windows, Linux, and Intel Mac installers are not included.
- From beta.6, select Beta in Settings and check for updates to install rc.1. Stable does not offer this prerelease. From beta.5 or earlier, install the DMG manually.
- Validate the signed beta.6-to-rc.1 update, restart, retained local data, and AV1 conversion before the official 0.1.0 release. Installation must remain unavailable while conversions are queued or running.
- The macOS bundle version remains 0.1.0; the full release identity is v0.1.0-rc.1.

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
