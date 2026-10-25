## Summary

<!-- What changed, and why. -->

## Checks

- [ ] Source, interface text, documentation, tests, and commit messages are in English.
- [ ] Behavior changes have focused tests, especially for queue state, FFmpeg arguments, path validation, and parsers.
- [ ] Source files stay untouched. An unfinished temporary output is removed after failure or cancellation. An existing destination file is replaced only after explicit confirmation and a successful conversion.
- [ ] New dependencies or codecs were reviewed for GPL-3.0-or-later. If Rust dependencies changed, `cargo deny check --manifest-path src-tauri/Cargo.toml --locked` was run with cargo-deny 0.20.2.
- [ ] `pnpm check` and `git diff --check` were run.

## Verification

<!-- Commands you ran. For a user-facing or workflow change, note what you checked. Desktop interface changes must be checked in the Tauri app, not only in a browser. -->
