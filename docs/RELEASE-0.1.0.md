# Vidra 0.1.0 release checklist

Status: preparation only. This checklist does not announce a published release. The preparation pull request does not create a tag, build release artifacts, or publish a GitHub release.

## Scope

- First official release for macOS on Apple Silicon.
- Existing conversion and desktop capabilities from `v0.1.0-beta.5`, with the release policy documented in [ROADMAP.md](ROADMAP.md).
- Stable and Beta update channels, with Stable selected by default and the choice stored locally.
- No Windows, Linux, or Intel Mac installers in this release.
- Application version `0.1.0`; intended release tag `v0.1.0`, with no beta suffix.

## Preparation review

- [ ] Review and merge the preparation pull request after CI passes.
- [ ] Run `pnpm check`, `VIDRA_FFMPEG_MODE=release pnpm ffmpeg:prepare`, `pnpm release:check -- v0.1.0`, and `git diff --check` on the release candidate source.
- [ ] Review dependency licenses, pinned FFmpeg sources, and bundled notices. Preserve `LICENSE`, `COPYRIGHT`, and `THIRD_PARTY_NOTICES.md`.
- [ ] Confirm that no known release-blocking defects remain and record any known limitations in the release notes.

## Build and artifact verification

Follow [RELEASING.md](RELEASING.md). Complete these steps when the release is authorized, after the preparation PR is merged.

- [ ] Replace the `Unreleased` heading for 0.1.0 in `CHANGELOG.md` with the intended release date and update the README to describe the official release. Merge that final documentation change before tagging.
- [ ] Create and push the signed `v0.1.0` tag from the reviewed `main` commit.
- [ ] Confirm the release workflow succeeds and creates a draft with the prerelease flag disabled.
- [ ] Confirm the draft contains the signed and notarized Apple Silicon DMG, DMG checksum, signed updater archive and signature, `latest.json`, FFmpeg corresponding sources, source checksums, and build configuration.
- [ ] Confirm `latest.json` uses version `0.1.0` and that its `darwin-aarch64` URL and signature match the attached updater archive.
- [ ] Install and launch the DMG on a second Apple Silicon Mac without development tools or Homebrew. Record the macOS version and results.
- [ ] Verify media inspection, H.264/H.265/AV1 conversion, MP4/MKV output, compatible audio and subtitle handling, HDR-to-SDR conversion, HDR preservation, and output playback.
- [ ] Verify multiple queued jobs, pause/resume, cancellation, restart recovery, failure cleanup, and source-file preservation, including existing destination filenames.
- [ ] Verify Finder Open With, drag and drop, appearance persistence, history, and destination-space warnings.
- [ ] Verify the Stable default, Beta opt-in, persisted channel after restart, manual checks on each channel, and the channel selector being unavailable during installation. Confirm switching back to Stable never offers a downgrade or leaves a stale Beta install action.

## Publication and update verification

- [ ] Review the draft notes against the 0.1.0 changelog and clearly state the supported platform and known limitations.
- [ ] Publish the draft as an official GitHub release and mark it as the latest release.
- [ ] Confirm the updater publication workflow points `latest.json` (Stable) to `v0.1.0` and `beta.json` (Beta) to `v0.1.0` or an already-published newer prerelease.
- [ ] From the signed `v0.1.0-beta.5` build on the second Mac, confirm the update prompt, blocked installation while conversions are queued or running, successful update and restart, the exact `v0.1.0` release identity, retained local data, and a short conversion.

The previous beta and 0.1.0 share the macOS bundle version `0.1.0`. The update check must compare their full release identities (`0.1.0-beta.5` and `0.1.0`), so testing only the displayed bundle version is insufficient.

Record validation evidence in the release PR or release review, including the tested commit or tag, machine and operating-system version, checks performed, and unresolved limitations. Leave checks incomplete until there is evidence for them. If a published artifact is defective, follow the rollback policy and publish a new version; do not replace its files.
