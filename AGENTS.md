# Vidra Repository Guidelines

Vidra is an open-source, local-first desktop video converter built with Tauri, Rust, React, and bundled FFmpeg tools. macOS on Apple Silicon is the only supported target.

## Product rules

- Media stays on the user's device. Add no upload, telemetry, account, or network processing without explicit approval.
- Preserve source media. Never modify or delete an input file.
- Keep all repository content in English: source code, UI copy, documentation, comments, errors, tests, commit messages, release notes, and filenames. Discussion with the user may follow the user's language.
- Prefer clear product language over raw FFmpeg terminology in the interface.
- Vidra is licensed under GPL-3.0-or-later. Preserve `LICENSE`, `COPYRIGHT`, and `THIRD_PARTY_NOTICES.md`, and review the license and bundled-binary implications of every new dependency or codec.
- Never commit credentials, signing keys, notarization secrets, updater private keys, or FFmpeg binaries.
- Commit or push only when the user asks for it, and stage only the files of the change.

## Tooling

- pnpm is the only JavaScript package manager. Its version is pinned in `package.json`.
- `pnpm ffmpeg:prepare` installs the FFmpeg and FFprobe sidecars into `src-tauri/binaries/` from the checksum-pinned archive in `scripts/ffmpeg/dev-archive.json`. A system FFmpeg is never used. The app treats the sidecars as ready only when both report the version pinned in `scripts/ffmpeg/sources.json`.
- `scripts/ffmpeg/sources.json` pins the sources and checksums of the release recipe. The archive's FFmpeg version and recipe fingerprint must match that recipe. `pnpm ffmpeg:prepare -- --build` compiles the recipe locally.
- `pnpm icon:prepare` regenerates the macOS Icon Composer assets with Xcode 26 or later. The generated fallback assets in `src-tauri/generated/` stay committed for machines without Xcode.

## Frontend architecture

- `src/app/App.tsx` composes, navigates, and wires. Domain workflows and Tauri IPC calls live elsewhere.
- Stateful domain workflows and event subscriptions go in focused hooks under `src/hooks/`.
- Tauri command wrappers go in `src/services/`. Components and hooks call services and never import `invoke`.
- Pure formatting and domain helpers go in `src/lib/`. Static product configuration goes in `src/config/`.
- Components stay focused and presentational. Split a component when it owns unrelated workflows or becomes difficult to scan.
- Shared media and job contracts live in `src/types/media.ts` and mirror the Rust serialization names exactly.
- Preserve the native desktop interaction model: no document-level scrolling, no browser-like text selection, and working native drag regions. Scroll only bounded lists or panels.
- Reuse the typography, spacing, color, icon, and shape tokens in `src/styles/tokens.css`.
- Use Lucide through the shared `Icon` component.

## Rust architecture

- Tauri commands stay thin. They validate their API boundary and delegate to domain modules.
- FFmpeg command construction: `src-tauri/src/ffmpeg/encode.rs` and `encode/`.
- Queue orchestration, process events, and sequential execution: `src-tauri/src/ffmpeg/queue.rs`.
- Synchronized job state and queue mutations: `src-tauri/src/jobs/`.
- FFprobe parsing: `src-tauri/src/ffmpeg/probe.rs`. Progress parsing: `src-tauri/src/ffmpeg/progress.rs`.
- Destination publication and unfinished temporary outputs: `src-tauri/src/output/`.
- Return structured `ApiError` values with stable codes and useful English messages. Keep implementation details out of the UI.
- Release every mutex before an `.await` or a long-running process operation.
- One FFmpeg encoding process runs at a time.
- Platform-specific process behavior sits behind `cfg`-gated helpers with a clear unsupported-platform error, so another platform can be added later.

## Encoding behavior

- Copy compatible audio streams without re-encoding whenever possible. When audio must be converted, stay at or below a known source bitrate.
- Keep container-specific stream mapping explicit. MKV preserves compatible subtitles, chapters, metadata, and tracks. MP4 uses compatible mappings and codec tags.
- Validate every input and output path in Rust, even when the frontend already validated it.
- Encode into a temporary file in the destination directory and move it into place only after success. Failure, cancellation, and shutdown may remove that temporary file and leave the source unchanged.
- An existing destination file is replaced only when replacement was confirmed and the conversion succeeds. A successful conversion whose destination name is taken is saved under the next free numbered name.
- Quality presets stay stable. A change to a CRF value or codec behavior comes with a test.
- FFmpeg stderr is diagnostic data. Show users concise failures and bound what is stored.

## Proof

Prove a change with these commands from the repository root. Each one passes on `main`.

```sh
pnpm install --frozen-lockfile
pnpm ffmpeg:prepare   # Pinned, checksum-verified sidecars into src-tauri/binaries (gitignored)
pnpm build            # TypeScript check, then the frontend bundle
pnpm test             # Vitest, then the node tests of scripts/
cargo fmt --manifest-path src-tauri/Cargo.toml --check
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml   # Every test passes; conversion_corpus is the one ignored test
cargo test --manifest-path src-tauri/Cargo.toml --lib conversion_corpus -- --ignored --nocapture   # Ends with a "Corpus matrix:" line
git diff --check
```

- A behavior change comes with a test: Rust tests for queue state, FFmpeg arguments, path validation, and parsers; Vitest for hooks, components, and helpers.
- A test that cannot run fails. The corpus and the FFmpeg-backed tests fail when a sidecar, an encoder, or a filter is missing. Add no skip.
- `pnpm ffmpeg:prepare` reuses a verified archive in `.cache/ffmpeg/aarch64-apple-darwin/`. When the GitHub download fails, copy that file from another checkout. The checksum is still enforced.
- CI also runs `cargo deny check --manifest-path src-tauri/Cargo.toml --locked` (cargo-deny 0.20.2). Run it locally when Rust dependencies change and cargo-deny is installed.
- Observe a UI change in the Tauri app, not only in a browser, under a throwaway identifier. A plain `pnpm tauri dev` writes conversion history and the partial-output ledger into the installed Vidra's `~/Library/Application Support/io.github.mathieumaf.vidra/`:

  ```sh
  pnpm tauri dev --config '{"identifier":"io.github.mathieumaf.vidra.proof"}'
  ```

  The dev binary keeps its WebKit storage in `~/Library/WebKit/vidra`, apart from the installed app, but every dev run shares it. Decline any pending-queue restore offer.
- Convert only synthetic clips, into a temporary destination folder. `node scripts/corpus/generate.mjs --output <new folder>` writes them. Never open the user's own media or write into their folders.
- Off limits: pushing a `v*` tag, running or dispatching `release.yml`, `publish-updater.yml`, or `ffmpeg-dev-archive.yml`, `gh release` writes, `pnpm ffmpeg:release`, release signing or notarization, and installing an update into `/Applications/Vidra.app`. Prove release and updater changes with `pnpm test` (the `scripts/release` node tests) instead.

## Code Review Rules

- **It touches user media.** Code in `src-tauri/src/output/`, `ffmpeg/segment.rs`, or `ffmpeg/queue.rs` that writes, renames, or removes anything other than its own temporary partial, replaces a destination without confirmation, or can reach the source path.
- **It silently loses streams or quality.** Mapping in `ffmpeg/encode.rs` and `ffmpeg/encode/` that drops audio, subtitle, chapter, or HDR metadata the container can hold, raises a known audio bitrate, or changes a preset without a test.
- **It trusts the frontend.** A Tauri command that uses an IPC path or value without Rust validation (`ffmpeg/paths.rs`), lets user text become an FFmpeg option, or widens `src-tauri/capabilities/` or opener URLs.
- **It stalls or races the queue.** A mutex held across an `.await` or a process wait in `jobs/` or `queue.rs`, a second concurrent FFmpeg process, or job state left behind after cancel, failure, or shutdown.
- **It weakens the supply or update chain.** An unpinned or unverified sidecar in `scripts/ffmpeg/`, a changed updater endpoint or `pubkey` in `tauri.conf.json`, an update offered for anything other than a newer official release, a release script that can publish an unverified manifest, or any new network call, telemetry, or upload.

The security invariants and what counts as a vulnerability are in `SECURITY.md`. The threat model is `docs/security/threat-model.md`.

Skip `src-tauri/generated/` (generated icon assets). Keep `pnpm-lock.yaml` and `src-tauri/Cargo.lock` in review.

Cite file:line for every finding, and post at most 3 nits.

## Risk

- **High:** `src-tauri/src/output/**`, `src-tauri/src/ffmpeg/paths.rs`, `src-tauri/src/ffmpeg/segment.rs`, `src-tauri/src/ffmpeg/queue.rs`, `src-tauri/src/ffmpeg/encode.rs`, `src-tauri/src/ffmpeg/encode/**`, `src-tauri/src/ffmpeg/binary.rs`, `src-tauri/src/jobs/**`, `src-tauri/src/history/**`, `src-tauri/src/commands/**`, `src-tauri/src/application_update.rs`, `src-tauri/src/lib.rs`, `src/types/media.ts`, `src/services/**`, `src-tauri/tauri*.conf.json`, `src-tauri/capabilities/**`, `src-tauri/build.rs`, `src-tauri/Cargo.toml`, `src-tauri/Cargo.lock`, `src-tauri/deny.toml`, `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `scripts/ffmpeg/**`, `scripts/release/**`, `.github/**`, `AGENTS.md`, `CLAUDE.md`, `SECURITY.md`, `docs/security/**`, `LICENSE`, `COPYRIGHT`, `THIRD_PARTY_NOTICES.md`.
- **Low:** the rest of `docs/**`, `README.md`, `CHANGELOG.md`, `CONTRIBUTING.md`, `design/**`, and tests: `*.test.ts`, `*.test.tsx`, `*.test.mjs`, `*.node-test.mjs`, `src/test/**`, `src-tauri/src/**/tests.rs`, `src-tauri/src/ffmpeg/queue_tests.rs`, `src-tauri/src/ffmpeg/corpus.rs`, and `#[cfg(test)]` modules.
- **Medium:** everything else. When paths overlap, the higher tier wins.
