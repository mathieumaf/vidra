# Vidra threat model

This document describes what Vidra protects, where untrusted data enters, which boundaries hold, and where they stop holding. The policy and the reporting channel are in [SECURITY.md](../../SECURITY.md). Revisit this model when a change adds a network call, a Tauri command, a capability, a file write, or a release step.

## System and deployed scope

Vidra is a desktop application for macOS on Apple Silicon. It converts video files on the user's computer with FFmpeg and FFprobe executables bundled in the app.

- **Interface:** a React application in the system WebView, loaded from files inside the app bundle (`src/`, `src-tauri/tauri.conf.json`).
- **Core:** a Rust process built with Tauri (`src-tauri/src/`). It owns the filesystem, the conversion queue, and the child processes.
- **Engine:** the `ffmpeg` and `ffprobe` sidecars in `src-tauri/binaries/`, started by the core with an argument list.
- **Distribution:** a signed and notarized DMG and a signed update archive, built by `.github/workflows/release.yml` and published as GitHub Releases. `.github/workflows/publish-updater.yml` then rewrites the update feed that installed copies read.

There is no server, account, telemetry, or cloud processing. The app is not sandboxed: no App Sandbox entitlement is configured in `src-tauri/`, so it runs with the user's own file permissions.

## Assets

| Asset | Why it matters |
| --- | --- |
| The user's source media | Often irreplaceable. A converter must never modify or delete its input. |
| Files in the destination folder | An output must not replace a file the user did not confirm. |
| Other files the user can write | The app runs with the user's permissions, so a path mistake reaches them. |
| Privacy of media and file paths | Nothing about the user's media may leave the device. |
| The installed application | An update replaces the app that holds all of the above. |
| The updater signing key, the Apple Developer ID certificate, and the notarization credentials | They let someone publish software that installed copies trust. The repository holds none of them. The release workflow reads them from GitHub Actions secrets. |
| Local application data | Conversion history, the partial-output ledger, encoding profiles, and the pending queue. |

## Actors

- **The user.** Trusted. Chooses the sources, the destination, and whether to replace a file.
- **A media file's author.** Untrusted. The user may convert a file received from anyone.
- **Other local software.** Can change files in a destination folder while a job waits or runs, and can launch Vidra with arguments. The model covers what Vidra does to the user's files under that interference. Software that already runs as the user and attacks the app, its bundle, or its data files directly is outside it.
- **A network attacker.** Can interfere with the connection to GitHub during an update check or download.
- **A contributor or a dependency.** Can propose code, a workflow change, or a new version of a package, an action, or an FFmpeg source.

## Entry points and untrusted inputs

| Input | Enters through | Handling |
| --- | --- | --- |
| Media file contents | FFprobe and FFmpeg decode them in child processes | The core does not decode media. It parses text that the engine derives from it: FFprobe's JSON (`ffmpeg/probe.rs`), FFmpeg's progress and stderr (`ffmpeg/progress.rs`, `diagnostics.rs`), and, when trimming, FFprobe's keyframe list and extracted SubRip subtitles (`ffmpeg/segment.rs`). |
| File names and embedded metadata (titles, languages, chapter names) | FFprobe JSON, then the interface and, when trimming, FFmpeg again | Values shown in the interface are rendered by React as text. The interface inserts no raw HTML, and the content security policy in `tauri.conf.json` allows no remote script, frame, or connection. When trimming, the core writes chapter titles to a metadata file and passes subtitle titles and languages as the value of a `-metadata` argument (`ffmpeg/segment.rs`). They are argument values in a list, never a shell string or an option name. |
| Source and output paths | `probe_media`, `segment_keyframe`, `enqueue_encodes` | Validated again in Rust (`ffmpeg/paths.rs`): absolute, canonical, a readable regular file for a source; a real folder, the right extension, not a symbolic link, and not the same file as any source for an output. |
| Other paths from the interface | `list_destination_files`, `reveal_output_file`, `save_diagnostic_report` | Lighter checks of their own (`output/mod.rs`, `diagnostics.rs`). Listing accepts any absolute folder the user can read and returns its file names to the interface. Revealing accepts any absolute path to an existing file and shows it in Finder. Saving a report is described below. |
| Files opened from Finder or a second launch | `open_files.rs` (process arguments, `RunEvent::Opened` URLs) | Only file paths with a supported video extension are kept. They then follow the same probe path as any other source. |
| Encoding settings | `enqueue_encodes` | Typed enums and bounded numbers (`ffmpeg/types.rs`), checked against the probed media before a command is built (`ffmpeg/encode.rs`). |
| Diagnostic report text | `save_diagnostic_report` | The core builds the report and redacts source and output paths in it (`diagnostics.rs`). The interface shows it and passes the text back with a path to save it. The core cannot tell that the text is the one it built. It enforces a size limit, an absolute `.txt` path in an existing folder, and creation of a new file: an existing file, hard link, or symbolic link is refused. |
| The update manifest and archive | `application_update.rs`, from the HTTPS endpoint in `tauri.conf.json` | See "Installing an update" below. |
| Browser storage (profiles, pending queue, theme) | `localStorage` in the WebView | Parsed defensively (`src/lib/pendingQueue.ts`, `src/hooks/useEncodingProfiles.ts`). A restored queue goes through the same Rust validation as a new one. |
| Application data files | `conversion-history.json`, `partial-outputs.json` in the app data folder | Read at startup. The ledger decides which unfinished temporary files are removed (`output/partial.rs`). |
| Pull requests, dependency updates, FFmpeg sources | GitHub | Reviewed under `AGENTS.md`. FFmpeg sources and the FFmpeg archive are pinned by SHA-256 (`scripts/ffmpeg/sources.json`, `scripts/ffmpeg/dev-archive.json`), and a download is checked against its pin before it is installed. Actions are pinned by commit. `pnpm install --frozen-lockfile` and `cargo deny --locked` fail on a lockfile that does not match. |

## Trust boundaries

1. **WebView to core.** The interface can call only the commands registered in `lib.rs`. The capability file (`src-tauri/capabilities/default.json`) grants it `core:default`, window dragging and maximizing, `dialog:default`, and opening two kinds of link: the repository URL and `https://github.com/mathieumaf/vidra/releases/tag/v*`. It has no shell, filesystem, or HTTP plugin permission. Its access to files goes through the commands, and the core treats every argument as untrusted.
2. **Core to engine.** FFmpeg and FFprobe run as separate processes with an argument vector built in Rust, never through a shell. The source is a canonical absolute path, and the output is a temporary file the core created.
3. **Core to filesystem.** During conversion the core writes the temporary output (`.vidra-partial-…`) in the destination folder, the published output, and work files in a folder it creates under the system temporary folder. It also writes its own data files, a diagnostic report when the interface asks, and, through the updater, the application bundle.
4. **Device to network.** The core requests the update manifest from the fixed endpoint, then the archive at the URL that manifest names. The interface opens the two kinds of link above in the browser. Nothing else connects.
5. **Repository to release.** A release is built by `release.yml` from a pushed tag, in the GitHub environment named `release`, with the signing secrets of that environment. `publish-updater.yml` runs with the repository token, outside that environment, and rewrites the update feed when a release is published.

## Sensitive data flows and privileged actions

- **Reading a source.** FFprobe and FFmpeg open the source for reading. No code path opens it for writing, renames it, or deletes it. An output path that names a source, or a hard link to one, is refused, including the source of another waiting or running job (`ffmpeg/paths.rs`, `jobs/manager.rs`).
- **Writing the temporary output.** The core creates the temporary file with a name of its own, then gives FFmpeg its path with `-y` (`output/partial.rs`, `ffmpeg/encode.rs`). FFmpeg opens that path itself.
- **Publishing an output to a free name.** The core moves the temporary file with an exclusive rename, which fails when the name is taken (`output/partial.rs`).
- **Replacing an existing file.** The macOS save panel asks the user. The interface infers that answer from the destination folder's listing and sets a flag on the request. When the job is queued, the core records the identity (device and inode) of the file then at that path (`ffmpeg/queue.rs`). After a successful conversion it replaces the destination only if the file there still has that identity, with a check followed by an ordinary rename.
- **When the name is not available.** The finished video is kept, under the next free numbered name. If no numbered name can be used, it is kept under a `name.vidra-saved-….ext` name, or it stays at its temporary name, and the job reports where it is (`output/partial.rs`).
- **Cleaning up.** There are three paths. After failure or cancellation, the core removes its temporary file only if the file at that path is still the one it created. At startup and at quit, it goes through the ledger and removes the file at each recorded path when that file is the recorded one or still has a Vidra temporary name. Trimming removes the work folder it created exclusively for the job (`output/partial.rs`, `ffmpeg/segment.rs`).
- **Controlling the engine.** The core pauses, resumes, and stops only the sidecar processes it started and tracks: FFmpeg, and FFprobe while a trim is prepared (`jobs/process.rs`, `ffmpeg/segment.rs`).
- **Installing an update.** The core offers an update only when the manifest announces an official version newer than the installed one, never a prerelease or a downgrade (`application_update.rs`). The updater plugin downloads the archive from the URL in the manifest and verifies its signature against the public key in `tauri.conf.json`. Installation is refused while a conversion is queued, running, or paused. It replaces the application bundle and restarts the app.
- **Signing a release.** The workflow signs with the Developer ID certificate and the updater key, notarizes with Apple, and creates a draft release. The maintainer publishes it by hand.

## Known limits

- **FFmpeg parses hostile files.** A memory-safety bug in an FFmpeg decoder or demuxer could run code as the user, because the engine is not sandboxed. Vidra reduces this by shipping one pinned FFmpeg version and updating it, not by isolation.
- **Replacement is a check followed by a rename.** Between the identity check and the rename, other software can put a different file at the destination, and that file is replaced.
- **A confirmed replacement follows the file, not its contents.** A file edited in place keeps its identity, so an edit made while the job waits is lost ([issue #120](https://github.com/mathieumaf/vidra/issues/120)).
- **The exclusive rename has a fallback.** On volumes that reject it (some exFAT, FAT, and network shares), the core checks that the name is free and then renames. Another program could create that name in between.
- **The temporary output is addressed by path.** Other software that swaps the temporary file for a link before FFmpeg opens it can redirect the encode to another file the user can write.
- **Recovery trusts the ledger and the name.** A file that other software puts at a recorded path with a Vidra temporary name is removed at the next startup or quit.
- **The update version is checked on the manifest.** The plugin compares the version recorded in the archive's signature with the announced one only when the signature records a version. Vidra does not set `requireSignedVersion`, so a signature without one is accepted. Someone who controls the feed could announce a new version for an older, validly signed archive whose signature has no version.
- **The archive URL comes from the manifest.** The endpoint is fixed and uses HTTPS. The plugin warns about an archive URL that does not use HTTPS and still downloads it. The signature is then the only protection.
- **Local data is not authenticated.** Other software running as the user can edit the history, the ledger, or browser storage.

## Assumptions the repository cannot establish

These depend on settings outside the tracked files:

- The `release` environment requires the maintainer's approval and is restricted to release tags.
- Branch protection on `main` requires pull requests and the CI checks.
- The updater private key and the Apple credentials are held as secrets of that environment and in the maintainer's own recovery copy, and nowhere else.
- GitHub serves release assets over TLS, and the published assets are the ones the workflow built.
- The published FFmpeg archive was built by `.github/workflows/ffmpeg-dev-archive.yml` from the pinned sources.
- CI restores prepared sidecars from the Actions cache when the pin files are unchanged, without downloading and checking the archive again.
