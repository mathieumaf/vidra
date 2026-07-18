# Contributing to Vidra

Thank you for helping improve Vidra. Keep changes focused, preserve the local-first product model, and discuss substantial product or architecture changes in an issue before implementation.

## Development setup

Vidra currently targets macOS on Apple Silicon. Install Node.js 24, pnpm 11, Rust, the Tauri prerequisites, and Xcode when regenerating native icon assets.

```sh
pnpm install
pnpm tauri dev
```

Use pnpm for every JavaScript dependency operation. Do not commit generated FFmpeg binaries, credentials, signing material, media samples containing private data, or unrelated changes.

## Pull requests

- Keep source code, UI text, documentation, tests, and commit messages in English.
- Add focused tests for behavior changes, especially queue state, FFmpeg arguments, path validation, and parsers.
- Preserve source media and remove incomplete outputs after failure or cancellation.
- Review licensing and distribution implications before adding dependencies or codecs.
- Run `pnpm check` and `git diff --check` before requesting review.

User-facing or workflow changes should include concise manual verification notes. Meaningful desktop UI changes must be checked in the Tauri application, not only in a browser.
