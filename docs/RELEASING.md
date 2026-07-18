# Releasing Vidra

Vidra is currently distributed as a prerelease for macOS on Apple Silicon. Public builds must be created by the GitHub release workflow; development FFmpeg binaries must never be distributed.

## One-time Apple setup

An Apple Developer Program membership and a Developer ID Application certificate are required for direct distribution outside the Mac App Store. Add these GitHub Actions repository secrets:

- `APPLE_CERTIFICATE`: the Developer ID Application certificate exported as a base64-encoded PKCS #12 file;
- `APPLE_CERTIFICATE_PASSWORD`: the export password for that certificate;
- `APPLE_SIGNING_IDENTITY`: the full Developer ID Application identity;
- `APPLE_ID`: the Apple Account used for notarization;
- `APPLE_PASSWORD`: an app-specific password for that account;
- `APPLE_TEAM_ID`: the Apple Developer team identifier.

Create a protected GitHub Actions environment named `release`, require a maintainer's approval, store the secrets in that environment, and restrict deployment access to release tags.

## Prepare a beta

1. Update the version in `package.json`, `src-tauri/tauri.conf.json`, and `src-tauri/Cargo.toml` when the application version changes.
2. Move the relevant entries in `CHANGELOG.md` under a dated release heading.
3. Run `pnpm check`, `VIDRA_FFMPEG_MODE=release pnpm ffmpeg:prepare`, and `pnpm release:check` on an Apple Silicon Mac.
4. Review the dependency and codec licenses in `THIRD_PARTY_NOTICES.md`.
5. Commit the release changes through the normal pull-request process.

## Build and publish

Create and push a signed tag. A prerelease tag may add a suffix without changing the application bundle version:

```sh
git tag -s v0.1.0-beta.1 -m "Vidra 0.1.0 beta 1"
git push origin v0.1.0-beta.1
```

The release workflow then:

- runs the complete frontend and Rust checks;
- builds GPL-enabled FFmpeg and FFprobe from pinned, checksum-verified sources;
- builds, signs, and notarizes the Apple Silicon application and DMG;
- verifies the final application with `codesign` and Gatekeeper;
- creates a draft prerelease containing the DMG, its checksum, FFmpeg corresponding sources, and build configuration.

Download the draft artifacts and test installation, launch, media inspection, H.264/H.265/AV1 encoding, cancellation, and output playback on a second Apple Silicon Mac. Publish the draft only after those checks pass.

## Rollback

Do not replace artifacts attached to a published release. If a release is defective, mark it clearly in the release notes, publish a fixed version with a new tag, and leave the original source and checksums available for auditability.
