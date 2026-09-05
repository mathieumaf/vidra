# Vidra roadmap

Vidra is a local-first desktop video converter. Its core promise is to inspect videos, choose understandable conversion settings, and produce compatible files reliably while preserving the originals. Media stays on the user's device.

## Release milestones

| Version | Scope |
| --- | --- |
| 0.1.0 | First official release for macOS on Apple Silicon, based on the existing beta workflow. |
| 0.1.x | Bug fixes and reliability improvements within the 0.1 scope. |
| 0.2.0 and later 0.x releases | Core workflow improvements and progressive Windows and Linux support. Platform work is not tied to a specific minor version or date yet. |
| 1.0.0 | A dependable core workflow with validated distribution on macOS, Windows, and Linux. |

One version sequence covers the product across platforms. A new platform can first appear in a beta release; its availability and supported architectures must be stated in the release notes. Additional architectures, including Intel Macs, require their own build and validation work and are not a prerequisite for 1.0.

## Version policy

- Use three-part versions, such as `0.1.0`, with Git tags such as `v0.1.0`.
- Use patch releases for corrections and minor releases for new capabilities or intentional behavior changes during 0.x development. Document changes to saved settings or profiles and preserve user data where possible.
- Use suffixes such as `0.2.0-beta.1` or `1.0.0-rc.1` for test builds. An official 0.x release has no prerelease suffix and is not marked as a prerelease on GitHub.
- Keep application version metadata aligned across the JavaScript, Tauri, and Cargo manifests. A beta suffix may exist only in the release tag; the updater uses that full tag to order releases.
- Publish official releases to the shared application update feed. Beta and release-candidate builds are manual downloads until separate update channels are designed and implemented.
- Never replace the contents of a published version. Ship a new version for corrections.

These conventions use [Semantic Versioning](https://semver.org/) as a basis. The platform requirements for 1.0 are Vidra's product milestone, not a requirement imposed by SemVer.

## Acceptance criteria for 1.0

- **Core conversion:** inspection, MP4/MKV output, H.264/H.265/AV1 encoding, quality presets, resolution limits, compatible audio preservation, subtitle mapping, and the documented HDR behavior work on a representative media corpus. Hardware acceleration and codec limitations are documented per platform.
- **Queue reliability:** sequential jobs, progress, cancellation, supported pause/resume behavior, restart recovery, history, and actionable failures are verified without leaving incomplete output files.
- **Source and destination safety:** sources remain untouched, existing destination files are not overwritten, and inaccessible files, unavailable volumes, and insufficient disk space are handled clearly.
- **Desktop experience:** file picking, supported native file-opening and drag-and-drop flows, appearance preferences, and bounded-panel scrolling are validated in the native app on each supported operating system.
- **Platform distribution:** macOS, Windows, and Linux each have an explicitly documented set of supported versions and architectures, bundled FFmpeg/FFprobe builds, CI validation, and installation and launch checks on a clean machine. No system FFmpeg installation is required.
- **Updates and local data:** the supported upgrade path is verified for each distribution format, signed updates are tested where offered, and upgrades retain settings, profiles, history, and recoverable queue data.
- **Release quality:** no known release-blocking source-safety, conversion, installation, or update defects remain. Reproduction details and workarounds are documented for remaining limitations, and corresponding sources and license notices accompany distribution.

Version 1.0 does not require every possible codec, editing feature, operating-system version, or architecture. New capabilities can continue to arrive after 1.0 without expanding this milestone indefinitely.
