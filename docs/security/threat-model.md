# Vidra threat model

This document describes what Vidra protects, where untrusted data enters, and which boundaries hold. The policy and the reporting channel are in [SECURITY.md](../../SECURITY.md). Revisit this model when a change adds a network call, a Tauri command, a capability, a file write, or a release step.

## System and deployed scope

Vidra is a desktop application for macOS on Apple Silicon. It converts video files on the user's computer with FFmpeg and FFprobe executables bundled in the app.

- **Interface:** a React application in the system WebView, loaded from files inside the app bundle (`src/`, `src-tauri/tauri.conf.json`).
- **Core:** a Rust process built with Tauri (`src-tauri/src/`). It owns the filesystem, the conversion queue, and the child processes.
- **Engine:** the `ffmpeg` and `ffprobe` sidecars in `src-tauri/binaries/`, started by the core with an argument list.
- **Distribution:** a signed and notarized DMG and a signed update archive, published as GitHub Releases by `.github/workflows/release.yml`.

There is no server, account, telemetry, or cloud processing. The app is not sandboxed: no App Sandbox entitlement is configured in `src-tauri/`, so it runs with the user's own file permissions.

## Assets

| Asset | Why it matters |
| --- | --- |
| The user's source media | Often irreplaceable. A converter must never modify or delete its input. |
| Files in the destination folder | An output must not replace a file the user did not confirm. |
| Other files the user can write | The app runs with the user's permissions, so a path mistake reaches them. |
| Privacy of media and file paths | Nothing about the user's media may leave the device. |
| The installed application | An update replaces the app that holds all of the above. |
| The updater signing key, the Apple Developer ID certificate, and the notarization credentials | They let someone publish software that installed copies trust. They live only in the protected `release` environment of the GitHub repository. |
| Local application data | Conversion history, the partial-output ledger, encoding profiles, and the pending queue. |

## Actors

- **The user.** Trusted. Chooses the sources, the destination, and whether to replace a file.
- **A media file's author.** Untrusted. The user may convert a file received from anyone.
- **Other local software.** Can change files in a destination folder while a job waits or runs, and can launch Vidra with arguments. Software that already runs as the user and attacks the app directly is outside this model.
- **A network attacker.** Can interfere with the connection to GitHub during an update check or download.
- **A contributor or a dependency.** Can propose code, a workflow change, or a new version of a package, an action, or an FFmpeg source.

## Entry points and untrusted inputs

| Input | Enters through | Handling |
| --- | --- | --- |
| Media file contents | FFprobe and FFmpeg decode them in child processes | The core never parses media itself. It reads FFprobe's JSON (`ffmpeg/probe.rs`) and FFmpeg's progress and stderr text (`ffmpeg/progress.rs`, `diagnostics.rs`). |
| File names and embedded metadata (titles, languages, chapter names) | FFprobe JSON, then the interface | Rendered by React as text. The interface uses no raw HTML insertion, and the content security policy in `tauri.conf.json` allows no remote script, frame, or connection. |
| Paths chosen in the interface | Tauri commands in `commands/mod.rs` | Validated again in Rust (`ffmpeg/paths.rs`): absolute, canonical, a readable regular file for a source; a real folder, the right extension, not a symbolic link, and not the same file as any source for an output. |
| Files opened from Finder or a second launch | `open_files.rs` (process arguments, `RunEvent::Opened` URLs) | Only file paths with a supported video extension are kept. They then follow the same probe path as any other source. |
| Encoding settings | `enqueue_encodes` | Typed enums and bounded numbers (`ffmpeg/types.rs`), checked against the probed media before a command is built (`ffmpeg/encode.rs`). User text does not become an FFmpeg option. |
| The update manifest and archive | `application_update.rs`, from the endpoint in `tauri.conf.json` | The archive must carry a valid signature for the public key in `tauri.conf.json`. Only a newer official version is offered, never a prerelease or a downgrade. Installation is refused while a conversion is queued or running. |
| Browser storage (profiles, pending queue, theme) | `localStorage` in the WebView | Parsed defensively (`src/lib/pendingQueue.ts`, `src/hooks/useEncodingProfiles.ts`). A restored queue goes through the same Rust validation as a new one. |
| Application data files | `conversion-history.json`, `partial-outputs.json` in the app data folder | Read at startup. The ledger decides which unfinished temporary files are removed (`output/partial.rs`). |
| Pull requests, dependency updates, FFmpeg sources | GitHub | Reviewed under `AGENTS.md`. Sources and the FFmpeg archive are pinned by SHA-256 (`scripts/ffmpeg/sources.json`, `scripts/ffmpeg/dev-archive.json`). Actions are pinned by commit. Lockfiles are frozen in CI, and `cargo-deny` checks crate licenses, advisories, and sources. |

## Trust boundaries

1. **WebView to core.** The interface can call only the commands registered in `lib.rs`, and the capability file (`src-tauri/capabilities/default.json`) grants it window dragging, native dialogs, and two fixed GitHub URLs. It has no shell, filesystem, or HTTP permission. The core treats every argument as untrusted.
2. **Core to engine.** FFmpeg and FFprobe run as separate processes with an argument vector built in Rust, never through a shell. The source is a canonical absolute path, and the output is a temporary file the core created.
3. **Core to filesystem.** The core writes only: the temporary output (`.vidra-partial-…`) in the destination folder, the published output, segment work files in the system temporary folder, a diagnostic report the user saves, and its own data files.
4. **Device to network.** The only requests are the update check and download from GitHub Releases, and links the user opens in the browser.
5. **Repository to release.** A release is built only by the release workflow, from a tag, in the `release` environment, which requires the maintainer's approval and holds the signing secrets.

## Sensitive data flows and privileged actions

- **Reading a source.** The source is opened read-only by FFprobe and FFmpeg. No code path opens it for writing, renames it, or deletes it. An output path that names a source, or a hard link to one, is refused (`ffmpeg/paths.rs`, `jobs/manager.rs`).
- **Publishing an output.** FFmpeg writes a temporary file in the destination folder. After success the core moves it into place with an exclusive rename. An existing file is replaced only when the user confirmed that replacement and the file is still the one that was confirmed. Otherwise the output takes the next free numbered name (`output/partial.rs`, `ffmpeg/queue.rs`).
- **Cleaning up.** After failure, cancellation, or quit, the core removes only temporary files it recorded in its ledger and that still match their recorded identity (`output/partial.rs`).
- **Saving a diagnostic report.** Source and output paths are redacted (`diagnostics.rs`). The report is written only to a new `.txt` file: an existing file, a hard link, or a symbolic link is refused.
- **Controlling the encoder.** The core pauses, resumes, and stops only the FFmpeg process it started (`jobs/process.rs`).
- **Installing an update.** The update replaces the application bundle and restarts the app (`application_update.rs`).
- **Signing a release.** The workflow signs with the Developer ID certificate and the updater key, notarizes with Apple, and creates a draft release. The maintainer publishes it by hand.

## Known limits

- **FFmpeg parses hostile files.** A memory-safety bug in an FFmpeg decoder or demuxer could run code as the user, because the engine is not sandboxed. Vidra reduces this by shipping one pinned FFmpeg version and updating it, not by isolation.
- **The exclusive rename has a fallback.** On volumes that reject it (some exFAT, FAT, and network shares), the core checks that the name is free and then renames. Another program could create that name in between.
- **A confirmed replacement follows the file, not its contents.** The core replaces the destination only when it is still the same file as at confirmation. A file edited in place keeps that identity, so an edit made while the job waits is lost (issue #120).
- **Local data is not authenticated.** Other software running as the user can edit the history, the ledger, or browser storage.

## Assumptions the repository cannot establish

Marked unverified because they depend on settings outside the tracked files:

- The `release` environment requires approval and is restricted to release tags.
- Branch protection on `main` requires pull requests and the CI checks.
- The updater private key and the Apple credentials exist only as secrets of that environment, with an offline recovery copy.
- GitHub serves release assets over TLS, and the published assets are the ones the workflow built.
- The published FFmpeg archive was built by `.github/workflows/ffmpeg-dev-archive.yml` from the pinned sources.
