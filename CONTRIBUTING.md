# Contributing to Vidra

Thank you for helping improve Vidra. This page gets you from a clone to a pull request.

Three things do not change: media stays on the user's device, a source file is never modified, and nothing is uploaded or tracked. For a substantial product or architecture change, open an issue before writing code.

## Set up

You need a Mac with Apple Silicon and:

- Node.js 26 (the version is in `.node-version`) and pnpm 12 (pinned in `package.json`);
- [rustup](https://rustup.rs). It installs the Rust version named in `rust-toolchain.toml` by itself;
- the [Tauri prerequisites](https://tauri.app/start/prerequisites/), which on macOS means the Xcode Command Line Tools.

Xcode 26 or later is needed only to regenerate the app icon. Without it, the committed icon assets are used.

```sh
pnpm install
pnpm tauri dev --config '{"identifier":"io.github.mathieumaf.vidra.proof"}'
```

**Keep the `--config` part.** It gives the development build a throwaway identifier. A plain `pnpm tauri dev` shares the data folder of an installed Vidra, so your experiments would land in your real conversion history. Every development run still shares one browser storage, so decline any offer to restore a pending queue.

`pnpm tauri dev` first installs the FFmpeg engine: it downloads the archive pinned in `scripts/ffmpeg/engine.json`, checks its SHA-256, and puts `ffmpeg` and `ffprobe` in `src-tauri/binaries/`. Nothing is compiled, and a system FFmpeg is never used. `pnpm ffmpeg:prepare` does that step alone, and the tests need it.

Convert only synthetic clips while developing. `node scripts/corpus/generate.mjs --output <new folder>` writes a set.

## Find your way

[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) is the map: the three processes, where each kind of code lives, how a conversion travels through it, and step-by-step recipes for adding an encoding option, a command, or a codec.

The short version:

```text
src/              the interface (React). components draw, hooks hold workflows, services call the core
src-tauri/src/    the core (Rust). commands are thin, ffmpeg/ builds and runs encodes, output/ writes files
scripts/          the FFmpeg engine, release checks, test clips
```

The rules each area follows are in [AGENTS.md](AGENTS.md). They apply to people and to coding agents alike.

## Prove your change

```sh
pnpm ffmpeg:prepare   # once, and after the engine changes
pnpm check
git diff --check
```

`pnpm check` builds the interface, runs Vitest and the script tests, checks Rust formatting, runs Clippy with warnings as errors, runs the Rust tests, encodes the conversion corpus with the bundled engine, and checks the version files. It stops at the first failure. CI runs the same steps. Three checks are not part of it: the running app, the application bundle, and the Rust dependency policy (see [Dependencies](#dependencies)).

- A behavior change comes with a test. [docs/TESTING.md](docs/TESTING.md) says which kind goes where.
- A test never skips. If it cannot run, it fails.
- A change to the interface is checked in the running app, not only in a browser.
- A change to bundling, the Tauri configuration, or the engine is checked by building the bundle: see [The bundle](docs/TESTING.md#the-bundle).

## Open a pull request

- Keep it to one purpose. Source code, interface text, documentation, tests, and commit messages are in English.
- Fill in the template: what changed and why, the checks, and what you verified by hand.
- CI runs three jobs on a pull request to `main`: the Apple Silicon validation, the application bundle, and the Rust dependency policy. They must pass on a branch that is up to date with `main`.
- Answer every review finding, from a person or from an automated reviewer: fix it, or say why not.
- `main` takes squashed pull requests, so write the title as a sentence that says why the change matters.

Do not commit FFmpeg binaries, credentials, signing material, or media.

## Dependencies

Vidra is GPL-3.0-or-later, and it bundles FFmpeg. Before adding a dependency or a codec, check that its license can be combined with that. Record a bundled component in `THIRD_PARTY_NOTICES.md` and in `src/config/legal.ts`, which is what Settings shows.

Rust crate licenses, security advisories, and crate sources are checked with [cargo-deny](https://embarkstudios.github.io/cargo-deny/) 0.22.0. The rules are in `src-tauri/deny.toml`. CI runs it on every pull request. To run it yourself when Rust dependencies change:

```sh
cargo deny check --manifest-path src-tauri/Cargo.toml --locked
```

A duplicate crate version is a warning, not a failure. Do not add a version skip for an ordinary duplicate. Add a license to the allow list only when it can be combined with GPL-3.0-or-later, and write the reason in `src-tauri/deny.toml`.

## Releases

Maintainers publish releases. The steps, the workflows, and how the FFmpeg engine is updated are in [docs/RELEASING.md](docs/RELEASING.md).

## Security

Do not open a public issue for a vulnerability. [SECURITY.md](SECURITY.md) has the private reporting channel and what Vidra guarantees.
