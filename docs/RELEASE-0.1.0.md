# Vidra 0.1.0 release checklist

Status: preparation only. This checklist does not announce a published release. The preparation pull request does not create a tag, build release artifacts, or publish a GitHub release.

## Scope

- First official release for macOS on Apple Silicon.
- Conversion and desktop capabilities from the validated 0.1.0 prereleases, with the release policy documented in [ROADMAP.md](ROADMAP.md).
- Stable and Beta update channels, with Stable selected by default and the choice stored locally.
- No Windows, Linux, or Intel Mac installers in this release.
- Application version `0.1.0`; intended release tag `v0.1.0`, with no beta suffix.

## Prerelease validation

Beta.6 is published. The next planned test release is `v0.1.0-rc.1`, including the software AV1 decoding fix. Its changelog date is the intended publication date; adjust it before tagging if publication moves to a later day. The application bundle version remains `0.1.0`. Complete release preparation through the normal PR process before tagging. The beta.6 checklist below retains validation requirements; an unchecked item is not evidence of completion.

- [ ] Review the rc.1 changelog and run `pnpm check`, `pnpm ffmpeg:release`, `pnpm release:check -- v0.1.0-rc.1`, and `git diff --check`.
- [ ] Verify rc.1 signatures, notarization, corresponding sources (including dav1d), checksums, and the exact updater manifest version `0.1.0-rc.1`.
- [ ] Verify AV1 input conversion with the signed rc.1 app, including 8-bit SDR and 10-bit HDR sources.

- [ ] Review the beta.6 changelog and run `pnpm check`, `pnpm release:check -- v0.1.0-beta.6`, and `git diff --check` on the reviewed source.
- [ ] Build beta.6 with the signed-tag release workflow in [RELEASING.md](RELEASING.md). Verify the signed and notarized DMG, updater archive and signature, source archives, and checksums. Confirm the draft is marked as a prerelease and its manifest version is `0.1.0-beta.6`.
- [ ] Install the beta.6 DMG manually on a second Apple Silicon Mac, including an upgrade from beta.5. Verify the exact release identity, retained local data, conversions, queue behavior, cancellation, and source preservation.
- [ ] Verify Stable is selected by default, switching to Beta persists after restart, and manual checks work on both channels. A channel must not offer to reinstall the current beta.6 build.
- [ ] Publish beta.6 as a prerelease after artifact validation. Confirm `beta.json` advances to `0.1.0-beta.6` while the rolling `latest.json` stays unchanged. Save the before/after versions and artifact checks in the release review.
- [ ] After beta.6 validation, prepare and publish `v0.1.0-rc.1` through the same reviewed release process. From beta.6, confirm Beta offers rc.1 and Stable ignores it; switching back to Stable must clear the Beta install action.
- [ ] On Beta, verify installation of rc.1 is blocked while conversions are queued or running, then complete the signed update and restart. Confirm local data is retained, the exact release identity is `v0.1.0-rc.1`, and a short conversion succeeds.

Beta.5 and earlier have no channel selector and require manual installation of beta.6. The beta.5 updater uses the legacy `latest.json` endpoint, which may still name beta.5 before the first official publication; Stable in beta.6 must ignore it. Publishing beta.6 alone validates distribution and channel selection, while the subsequent release candidate exercises a complete update through the new Beta channel.

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
- [ ] Verify the official update from the legacy signed `v0.1.0-beta.5` build and from a channel-aware prerelease (beta.6 or rc.1), checking Stable and Beta eligibility. Confirm the update prompt, blocked installation while conversions are queued or running, successful update and restart, the exact `v0.1.0` release identity, retained local data, and a short conversion.

The betas, release candidate, and official release share the macOS bundle version `0.1.0`. The update check must compare their full release identities (for example, `0.1.0-beta.6`, `0.1.0-rc.1`, and `0.1.0`), so testing only the displayed bundle version is insufficient.

Record validation evidence in the release PR or release review, including the tested commit or tag, machine and operating-system version, checks performed, and unresolved limitations. Leave checks incomplete until there is evidence for them. If a published artifact is defective, follow the rollback policy and publish a new version; do not replace its files.
