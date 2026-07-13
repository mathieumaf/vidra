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
- Use `pnpm ffmpeg:prepare` for local FFmpeg and FFprobe sidecars. Do not rely on a system FFmpeg installation.
- Keep sidecar versions and checksums pinned in `scripts/ffmpeg/sources.json`.
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
- Return structured `ApiError` values with stable codes and useful English messages. Do not expose avoidable implementation details to the UI.
- Never hold a mutex across an async await point or a long-running process operation.
- Run one FFmpeg encoding process at a time unless parallel encoding is explicitly designed and approved.
- Keep platform-specific process behavior behind `cfg`-gated helpers with a clear unsupported-platform error.

## Encoding behavior

- Preserve compatible audio streams without re-encoding whenever possible.
- When audio conversion is required, never raise a known source bitrate.
- Keep container-specific stream mapping explicit. MKV should preserve compatible subtitles, chapters, metadata, and tracks; MP4 must use compatible mappings and codec tags.
- Validate all input and output paths in Rust, even if the frontend already validated them.
- Remove incomplete output files after cancellation or failure.
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
