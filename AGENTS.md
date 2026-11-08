# Vidra Repository Guidelines

This file applies to the entire repository.

## Communication and language

- Keep all repository content in English: source code, UI copy, documentation, comments, errors, tests, commit messages, release notes, and filenames.
- User-facing discussion may follow the user's language, but no French text belongs in tracked files.
- Prefer clear product language over raw FFmpeg terminology in the interface.

## Product scope

- Vidra is an open-source, local-first desktop video conversion application built with Tauri, Rust, React, and bundled FFmpeg tools.
- Media must remain on the user's device. Do not add uploads, telemetry, accounts, or network processing without explicit approval.
- macOS on Apple Silicon is the current primary target. Keep new abstractions portable so Windows, Linux, and additional architectures can be added later.
- Preserve source media. Never modify or delete an input file.

## Tooling

- Use pnpm as the only JavaScript package manager. The pinned version is declared in `package.json`.
- Use the Rust toolchain and Cargo for the Tauri backend.
- Use `pnpm ffmpeg:prepare` for local FFmpeg and FFprobe sidecars. Do not rely on a system FFmpeg installation for normal development. On Apple Silicon, that command downloads the checksum-pinned development archive and does not compile FFmpeg. `pnpm ffmpeg:prepare -- --build` compiles the pinned release recipe locally. `VIDRA_FFMPEG_DIR` may point at a directory containing `ffmpeg` and `ffprobe` for a development or CI build on any target, including Apple Silicon. Release builds reject that override. The app treats a sidecar as ready only when its reported version matches the pinned release FFmpeg version. A development override with a different version is not ready.
- Keep sidecar versions and checksums pinned in `scripts/ffmpeg/sources.json`. Pin the Apple Silicon development archive in `scripts/ffmpeg/dev-archive.json`. Its FFmpeg version and recipe fingerprint must match the release recipe.
- Use `pnpm icon:prepare` for macOS Icon Composer assets. Keep generated fallback assets committed for environments without Xcode.

## Frontend architecture

- Keep `src/app/App.tsx` focused on composition, navigation, and wiring. Do not place domain workflows or direct Tauri IPC calls there.
- Put stateful domain workflows and event subscriptions in focused hooks under `src/hooks/`.
- Put Tauri command wrappers in `src/services/`. Components and hooks should call services instead of importing `invoke` directly.
- Put pure formatting and domain helpers in `src/lib/` and static product configuration in `src/config/`.
- Keep components focused and presentational. Split a component when it owns unrelated workflows or becomes difficult to scan.
- Keep shared media and job contracts in `src/types/media.ts` and mirror Rust serialization names exactly.
- Preserve the native desktop interaction model: no document-level scrolling, no browser-like text selection, and working native drag regions. Scroll only bounded lists or panels when necessary.
- Reuse the typography, spacing, color, icon, and shape tokens in `src/styles/tokens.css`.
- Use Lucide through the shared `Icon` component instead of inline or text-based icons.

## Rust architecture

- Keep Tauri commands thin. Commands should validate their API boundary and delegate to domain modules.
- Keep FFmpeg command construction in `src-tauri/src/ffmpeg/encode.rs`.
- Keep queue orchestration, process events, and sequential execution in `src-tauri/src/ffmpeg/queue.rs`.
- Keep synchronized job state and queue mutations in `src-tauri/src/jobs/`.
- Keep FFprobe parsing in `src-tauri/src/ffmpeg/probe.rs` and progress parsing in `src-tauri/src/ffmpeg/progress.rs`.
- Keep destination publication and unfinished temporary outputs in `src-tauri/src/output/`.
- Return structured `ApiError` values with stable codes and useful English messages. Do not expose avoidable implementation details to the UI.
- Never hold a mutex across an async await point or a long-running process operation.
- Run one FFmpeg encoding process at a time unless parallel encoding is explicitly designed and approved.
- Keep platform-specific process behavior behind `cfg`-gated helpers with a clear unsupported-platform error.

## Encoding behavior

- Preserve compatible audio streams without re-encoding whenever possible.
- When audio conversion is required, never raise a known source bitrate.
- Keep container-specific stream mapping explicit. MKV should preserve compatible subtitles, chapters, metadata, and tracks; MP4 must use compatible mappings and codec tags.
- Validate all input and output paths in Rust, even if the frontend already validated them.
- Encode into a temporary file in the destination directory and move it into place only after success. Failure, cancellation, and shutdown may remove that temporary file and must leave the source unchanged. An existing destination file is replaced only when replacement was confirmed and the conversion succeeds. A successful conversion whose destination name is taken is saved under the next free numbered name instead of being deleted.
- Keep quality presets stable and covered by tests when changing CRF values or codec behavior.
- Treat FFmpeg stderr as diagnostic data. Present concise failures to users and avoid unbounded log storage.

## Quality and validation

Run the relevant checks before handing off a change. For a full validation, run:

```sh
pnpm build
cargo fmt --manifest-path src-tauri/Cargo.toml --check
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml
```

- Add or update Rust tests for queue state, argument construction, path validation, and parsers.
- Verify meaningful UI changes in the Tauri app, not only in a browser.
- Keep `git diff --check` clean.
- Do not commit or push changes unless the user explicitly asks for it.
- Do not stage unrelated user changes.

## Licensing and dependencies

- Vidra is licensed under GPL-3.0-or-later.
- Preserve `LICENSE`, `COPYRIGHT`, and `THIRD_PARTY_NOTICES.md` when changing distribution contents.
- Review the license and bundled-binary implications of every new dependency or codec.
- Never commit credentials, signing keys, notarization secrets, or updater private keys.

## Proof

Prove a change with these commands from the repository root. Each one passes on `main`.

```sh
pnpm install --frozen-lockfile
pnpm ffmpeg:prepare   # Pinned, checksum-verified sidecars into src-tauri/binaries (gitignored)
pnpm build
pnpm test
cargo fmt --manifest-path src-tauri/Cargo.toml --check
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml
VIDRA_CORPUS_REQUIRED=1 VIDRA_CORPUS_MATRIX=reduced VIDRA_CORPUS_STRICT_ENCODERS=1 \
  cargo test --manifest-path src-tauri/Cargo.toml --lib conversion_corpus -- --ignored --nocapture
git diff --check
```

- `pnpm ffmpeg:prepare` reuses a verified archive in `.cache/ffmpeg/aarch64-apple-darwin/`. When the GitHub download fails, copy that file from another checkout. The checksum is still enforced.
- CI also runs `cargo deny check --manifest-path src-tauri/Cargo.toml --locked` (cargo-deny 0.20.2). Run it locally when Rust dependencies change and cargo-deny is installed.
- Observe a UI change in the Tauri app under a throwaway identifier. A plain `pnpm tauri dev` writes conversion history and the partial-output ledger into the installed Vidra's `~/Library/Application Support/io.github.mathieumaf.vidra/`:

  ```sh
  pnpm tauri dev --config '{"identifier":"io.github.mathieumaf.vidra.proof"}'
  ```

  The dev binary keeps its WebKit storage in `~/Library/WebKit/vidra`, apart from the installed app. Convert only synthetic clips (`node scripts/corpus/generate.mjs --output "$(mktemp -d)/corpus"`) into a temporary destination folder. Never open the user's own media or write into their folders.
- Off limits: pushing a `v*` tag, running or dispatching `release.yml`, `publish-updater.yml`, or `ffmpeg-dev-archive.yml`, `gh release` writes, `pnpm ffmpeg:release`, signing or notarizing, and installing an update into `/Applications/Vidra.app`. Prove release and updater changes with `pnpm test` (the `scripts/release` node tests) instead.

## Review guidelines

- **It touches user media.** Code in `src-tauri/src/output/`, `ffmpeg/segment.rs`, or `ffmpeg/queue.rs` that writes, renames, or removes anything other than its own temporary partial, replaces a destination without confirmation, or can reach the source path.
- **It silently loses streams or quality.** Mapping in `ffmpeg/encode.rs` and `ffmpeg/encode/` that drops audio, subtitle, chapter, or HDR metadata the container can hold, raises a known audio bitrate, or changes a preset without a test.
- **It trusts the frontend.** A Tauri command that uses an IPC path or value without Rust validation (`ffmpeg/paths.rs`), lets user text become an FFmpeg option, or widens `src-tauri/capabilities/` or opener URLs.
- **It stalls or races the queue.** A mutex held across an `.await` or a process wait in `jobs/` or `queue.rs`, a second concurrent FFmpeg process, or job state left behind after cancel, failure, or shutdown.
- **It weakens the supply or update chain.** An unpinned or unverified sidecar in `scripts/ffmpeg/`, a changed updater endpoint or `pubkey` in `tauri.conf.json`, a release script that can publish to the wrong channel, or any new network call, telemetry, or upload.

Skip `src-tauri/generated/` and `src-tauri/icons/` (generated icon assets). Keep `pnpm-lock.yaml` and `src-tauri/Cargo.lock` in review.

Cite file:line for every finding, and post at most 3 nits.

## Risk

- **High:** `src-tauri/src/output/**`, `src-tauri/src/ffmpeg/paths.rs`, `src-tauri/src/ffmpeg/segment.rs`, `src-tauri/src/ffmpeg/queue.rs`, `src-tauri/src/history/**`, `src-tauri/src/commands/**`, `src-tauri/src/application_update.rs`, `src-tauri/src/lib.rs`, `src/types/media.ts`, `src/services/**`, `src-tauri/tauri*.conf.json`, `src-tauri/capabilities/**`, `src-tauri/build.rs`, `src-tauri/Cargo.toml`, `src-tauri/Cargo.lock`, `src-tauri/deny.toml`, `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `scripts/ffmpeg/**`, `scripts/release/**`, `.github/**`, `AGENTS.md`, `CLAUDE.md`, `LICENSE`, `COPYRIGHT`, `THIRD_PARTY_NOTICES.md`.
- **Low:** `docs/**`, `README.md`, `CHANGELOG.md`, `CONTRIBUTING.md`, `SECURITY.md`, `design/**`, and tests: `*.test.ts`, `*.test.tsx`, `*.test.mjs`, `*.node-test.mjs`, `src/test/**`, `src-tauri/src/**/tests.rs`, `src-tauri/src/ffmpeg/queue_tests.rs`, `src-tauri/src/ffmpeg/corpus.rs`, and `#[cfg(test)]` modules.
- **Medium:** everything else. When paths overlap, the higher tier wins.
