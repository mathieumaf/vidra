# Contributing to Vidra

Thank you for helping improve Vidra. Keep changes focused, preserve the local-first product model, and discuss substantial product or architecture changes in an issue before implementation.

## Development setup

Vidra currently targets macOS on Apple Silicon. Install Node.js 24, pnpm 11, Rust, the Tauri prerequisites, and Xcode when regenerating native icon assets.

```sh
pnpm install
pnpm tauri dev
```

Use pnpm for every JavaScript dependency operation. Do not commit generated FFmpeg binaries, credentials, signing material, media samples containing private data, or unrelated changes.

## Dependency policy

Rust crate licenses, security advisories, duplicate versions, and crate sources are checked with [cargo-deny](https://embarkstudios.github.io/cargo-deny/) 0.20.2. The rules live in `src-tauri/deny.toml`. From the repository root:

```sh
cargo deny check --manifest-path src-tauri/Cargo.toml --locked
```

Install that same cargo-deny version so the result matches CI. The command reads the lockfile through `cargo metadata`, so the installed Rust toolchain must be new enough to parse it. Prebuilt cargo-deny binaries are attached to its GitHub releases. CI runs this check on every pull request. Add a license to the allow list only when it can be combined with GPL-3.0-or-later, and record the reason in `src-tauri/deny.toml`.

## Pull requests

- Keep source code, UI text, documentation, tests, and commit messages in English.
- Add focused tests for behavior changes, especially queue state, FFmpeg arguments, path validation, and parsers.
- Preserve source media and remove incomplete outputs after failure or cancellation.
- Review licensing and distribution implications before adding dependencies or codecs. Run `cargo deny check --manifest-path src-tauri/Cargo.toml --locked` when Rust dependencies change.
- Run `pnpm check` and `git diff --check` before requesting review.

User-facing or workflow changes should include concise manual verification notes. Meaningful desktop UI changes must be checked in the Tauri application, not only in a browser.
