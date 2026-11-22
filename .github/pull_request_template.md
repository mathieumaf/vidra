## Summary

<!-- What changed, and why. -->

## Checks

- [ ] Source, interface text, documentation, tests, and commit messages are in English.
- [ ] Behavior changes have focused tests, especially for queue state, FFmpeg arguments, path validation, and parsers. No test skips.
- [ ] Source files stay untouched. An unfinished temporary output is removed after failure or cancellation. An existing destination file is replaced only after explicit confirmation and a successful conversion.
- [ ] New dependencies or codecs were reviewed for GPL-3.0-or-later. If Rust dependencies changed, `cargo deny check --manifest-path src-tauri/Cargo.toml --locked` was run with cargo-deny 0.20.2.
- [ ] `pnpm check` and `git diff --check` were run.

## Verification

<!-- Commands you ran and what they printed. For a change to the interface, what you saw in the running Tauri app. For a change to bundling or the engine, the bundle check. Say what you could not verify. -->
