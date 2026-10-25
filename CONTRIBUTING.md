# Contributing to Vidra

Thank you for helping improve Vidra. Keep changes focused, preserve the local-first product model, and discuss substantial product or architecture changes in an issue before implementation.

## Development setup

Vidra currently targets macOS on Apple Silicon. Install Node.js 24, pnpm 11, Rust, the Tauri prerequisites, and Xcode when regenerating native icon assets. `pnpm ffmpeg:prepare` downloads the checksum-pinned development archive for the current release recipe. It does not compile FFmpeg. macOS pull-request CI runs the same download. To compile the release recipe locally, run `pnpm ffmpeg:prepare -- --build` after installing the native build tools listed in [docs/RELEASING.md](docs/RELEASING.md).

Linux can compile the Rust crate and run the portable checks before a Linux port exists. Install the Tauri Linux dependencies and a local FFmpeg, then run `VIDRA_FFMPEG_DIR=/usr/bin pnpm ffmpeg:prepare` so the sidecar filenames exist. That override is for development and CI only. Release builds reject `VIDRA_FFMPEG_DIR` and still require the pinned Apple Silicon recipe. Vidra reports the engine as ready only when FFmpeg and FFprobe report the pinned release version. A different local build still prepares the filenames, and the app explains that it is not the pinned engine.

```sh
pnpm install
pnpm tauri dev
```

Use pnpm for every JavaScript dependency operation. Do not commit generated FFmpeg binaries, credentials, signing material, media samples containing private data, or unrelated changes.

## Conversion corpus

The 1.0 conversion check encodes a small synthetic corpus. Nothing from that corpus is committed. `scripts/corpus/generate.mjs` asks the prepared FFmpeg sidecar (or `VIDRA_FFMPEG_DIR` when the sidecar files are not there yet) for short lavfi clips:

| Clip | What it exercises |
| --- | --- |
| `sdr-h264-aac` | H.264 and AAC from `testsrc2` and a sine wave. Quality presets and the built-in profiles run on this clip. |
| `hdr10-hevc` | 10-bit HEVC tagged BT.2020 / SMPTE ST 2084. |
| `hlg-hevc` | 10-bit HEVC tagged BT.2020 / HLG (`arib-std-b67`). |
| `rotated-h264` | A 90 degree display matrix, with the coded frame left landscape. |
| `variable-frame-rate` | Two H.264 pieces concatenated so frame duration changes. |
| `mov-subtitles` | An MOV file with a text subtitle track. |
| `audio-only` | AAC with no video stream. |
| `corrupt` | The first bytes of a real MP4, truncated so inspection fails. |
| `unknown-transfer` | 10-bit HEVC with BT.2020 primaries, no transfer characteristic, and stream-level mastering-display metadata. |

A Dolby Vision clip is added only when this FFmpeg build writes a DOVI configuration record that FFprobe reports on the video stream. libx265 can name a Dolby Vision profile, but the record is not written unless an external RPU bitstream is passed to `dolby-vision-rpu`. lavfi cannot synthesize that RPU, and Vidra does not bundle Dolby's tools or `dovi_tool`. The generator prints that reason and still writes the HDR10 and HLG clips, which cover the backward-compatible base layer.

The Rust test `conversion_corpus` is ignored during ordinary `cargo test` so those checks stay fast. It probes every clip with the application's FFprobe parser, builds each command with `encode::command_arguments`, and publishes the result through the same temporary-file helper as the queue. Encodes run one at a time. From the repository root, after `pnpm ffmpeg:prepare`:

```sh
node scripts/corpus/generate.mjs --output /tmp/vidra-corpus
cargo test --manifest-path src-tauri/Cargo.toml --lib conversion_corpus -- --ignored --nocapture
```

`VIDRA_CORPUS_MATRIX=reduced` is the default and the matrix CI runs. On `sdr-h264-aac` it encodes every quality preset with efficient H.264 MP4, the Smaller file profile (efficient H.265 MP4), and the Fast export profile (hardware H.264 MP4). Every clip is also encoded with Copy, H.264, H.265, and AV1 into both MP4 and MKV at the balanced preset. `VIDRA_CORPUS_MATRIX=full` repeats every quality preset for every re-encode codec and container, and adds hardware H.264 and H.265 where the platform supports them. Fast AV1 is not part of either matrix because the app rejects it.

`VIDRA_CORPUS_REQUIRED=1` fails the test when Node or the FFmpeg sidecar is missing. Without that variable the test prints the reason and returns. `VIDRA_CORPUS_STRICT_ENCODERS=1` fails when libx264, libx265, libsvtav1, AAC, zscale, tonemap, or 10-bit output for H.265 and AV1 is missing. macOS CI sets it. Linux CI uses the system FFmpeg and skips a combination, with a message, when that build lacks the encoder or filter. On Linux, Fast export is expected to stop before FFmpeg with the unsupported-platform error. `VIDRA_CORPUS_KEEP=1` leaves the temporary clips and outputs in place.

## Dependency policy

Rust crate licenses, security advisories, and crate sources are checked with [cargo-deny](https://embarkstudios.github.io/cargo-deny/) 0.20.2. Duplicate crate versions are reported as warnings and do not fail the check. The rules live in `src-tauri/deny.toml`. From the repository root:

```sh
cargo deny check --manifest-path src-tauri/Cargo.toml --locked
```

Install that same cargo-deny version so the result matches CI. The command reads the lockfile through `cargo metadata`, so the installed Rust toolchain must be new enough to parse it. Prebuilt cargo-deny binaries are attached to its GitHub releases. CI runs this check on every pull request and fails it when a license, advisory, or crate source check fails. A duplicate-version warning is printed in that log for review. Do not add a version skip for an ordinary duplicate: a skip names an exact version and has to be updated on the next dependency bump. Add a license to the allow list only when it can be combined with GPL-3.0-or-later, and record the reason in `src-tauri/deny.toml`.

## Pull requests

- Keep source code, UI text, documentation, tests, and commit messages in English.
- Add focused tests for behavior changes, especially queue state, FFmpeg arguments, path validation, and parsers.
- Preserve source media. Remove an unfinished temporary output after failure or cancellation. Replace an existing destination file only after explicit confirmation and a successful conversion.
- Review licensing and distribution implications before adding dependencies or codecs. Run `cargo deny check --manifest-path src-tauri/Cargo.toml --locked` when Rust dependencies change.
- Run `pnpm check` and `git diff --check` before requesting review.

User-facing or workflow changes should include concise manual verification notes. Meaningful desktop UI changes must be checked in the Tauri application, not only in a browser.
