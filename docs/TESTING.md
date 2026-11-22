# Testing

Every change is proved before it is merged:

```sh
pnpm ffmpeg:prepare   # once, and after the engine changes: the tests run the bundled FFmpeg
pnpm check
git diff --check
```

`pnpm check` stops at the first failure. CI runs the same steps, each as its own step, plus two things a laptop does not need on every change: the unsigned application bundle and the Rust dependency policy. A change to the interface is also checked [in the app](#in-the-app).

## The layers

| Layer | What it proves | Where | Run it alone |
| --- | --- | --- | --- |
| TypeScript | The interface compiles with strict settings | `src/` | `pnpm build` |
| Vitest | Helpers, configuration, hooks, and components behave | `src/**/*.test.ts(x)` | `pnpm exec vitest run` |
| Script tests | The engine, release, and workflow scripts behave | `scripts/**/*.node-test.mjs` | `node --test "scripts/**/*.node-test.mjs"` |
| Rust tests | Path validation, FFmpeg arguments, parsers, queue state, output publication | `src-tauri/src/` | `cargo test --manifest-path src-tauri/Cargo.toml --locked` |
| Conversion corpus | Real encodes with the pinned engine produce the expected streams | `src-tauri/src/ffmpeg/corpus.rs` | `pnpm test:corpus` |
| Version files | The four version files agree on one official version | `scripts/release/check-version.mjs` | `pnpm release:check` |
| Bundle check | The application bundles and contains what the repository says | `scripts/release/verify-bundle.mjs` | see [The bundle](#the-bundle) |
| The app itself | A change to the interface looks and behaves right | The running Tauri app | see [In the app](#in-the-app) |

`cargo fmt --check` and Clippy with warnings as errors are part of `pnpm check` too.

## Rules

- **A behavior change comes with a test** at the lowest layer that can show it.
- **A test that cannot run fails.** The corpus and the FFmpeg-backed Rust tests fail when a sidecar, an encoder, or a filter is missing. There is no skip, so a green run always means the encodes happened.
- **Tests use synthetic media only.** Nothing from a real library is opened, and no media is committed.
- **Tests never contact GitHub or any other remote host.** The release scripts are tested through their real command line with a stand-in `gh`, and the download tests use a server on the local machine.

## Where to add a test

| You changed | Add |
| --- | --- |
| A pure helper in `src/lib/` or `src/config/` | A Vitest file next to it. |
| A hook | A Vitest file that mounts a small harness with `src/test/dom.tsx` and mocks the service module. |
| A component | A Vitest file that renders it with `mount` and clicks what a user would click. |
| FFmpeg arguments | A Rust test asserting the exact argument list, in `encode.rs`, `encode/video.rs`, or `encode/audio.rs`. |
| Path validation, the queue, output publication | A Rust test in the module's test section or its `tests.rs` file. These use temporary folders. |
| What an encode produces | A case in the conversion corpus. |
| An engine or release script | A `*.node-test.mjs` file next to it. |
| A workflow | An assertion in `scripts/ci/workflows.node-test.mjs`. `ci.yml` runs on the pull request itself. The release, update feed, and engine workflows run only from a tag, a published release, or by hand, so their properties are tested as text. |

## The conversion corpus

The corpus is the end-to-end test. It generates short clips with the engine, probes each one with Vidra's own FFprobe parser, builds each command with `encode::command_arguments`, runs FFmpeg, publishes the result through the same temporary-file code as the queue, and probes the output. It then checks codecs, containers, bit depth, HDR signalling, subtitles, and that every source file is unchanged.

It is one ignored Rust test, so plain `cargo test` stays fast:

```sh
pnpm test:corpus                          # the reduced matrix, a few seconds
VIDRA_CORPUS_MATRIX=full pnpm test:corpus # every quality preset with every re-encode codec and container
VIDRA_CORPUS_KEEP=1 pnpm test:corpus      # leave the clips and outputs in place
```

`scripts/corpus/generate.mjs` asks the engine for these clips. Run it on its own with `node scripts/corpus/generate.mjs --output <new folder>` when you need clips to try in the app.

| Clip | What it exercises |
| --- | --- |
| `sdr-h264-aac` | H.264 and AAC from `testsrc2` and a sine wave. Quality presets and the built-in profiles run on this clip. |
| `hdr10-hevc` | 10-bit HEVC tagged BT.2020 / SMPTE ST 2084, with mastering-display and content-light metadata. |
| `hlg-hevc` | 10-bit HEVC tagged BT.2020 / HLG (`arib-std-b67`). |
| `rotated-h264` | A 90 degree display matrix, with the coded frame left landscape. |
| `variable-frame-rate` | Two H.264 pieces concatenated so frame duration changes. |
| `mov-subtitles` | An MOV file with a text subtitle track. |
| `audio-only` | AAC with no video stream. |
| `corrupt` | The first bytes of a real MP4, truncated so inspection fails. |
| `unknown-transfer` | 10-bit HEVC with BT.2020 primaries, no transfer characteristic, and stream-level mastering-display metadata. |

The reduced matrix encodes every quality preset with efficient H.264 MP4, the Smaller file profile (efficient H.265 MP4), and the Fast export profile (hardware H.264 MP4) on `sdr-h264-aac`. Every clip except `corrupt` is also attempted with Copy, H.264, H.265, and AV1 into both MP4 and MKV at the balanced preset. The full matrix repeats every quality preset for every re-encode codec and container, and adds hardware H.264 and H.265.

Some attempts must be refused, and the test checks the refusal: `corrupt` fails inspection, copying the video of `audio-only` is rejected, and so is H.264 for `unknown-transfer`. The summary line counts them as clean rejections.

Known gaps:

- **Dolby Vision.** libx265 writes a Dolby Vision record only with an external RPU bitstream, which lavfi cannot make and Vidra does not bundle. The HDR10 and HLG clips cover the compatible base layer.
- **Opus encoding.** The corpus requires the Opus encoder but no case encodes with it yet.
- **Playback.** The corpus inspects outputs with FFprobe. It does not play them.

## The bundle

CI builds the application bundle without signing it and checks it, so a bundling failure shows on the pull request instead of on a release tag. Do the same after a change to bundling, the Tauri configuration, or the engine:

```sh
pnpm tauri build --bundles app --target aarch64-apple-darwin --no-sign --config '{"bundle":{"createUpdaterArtifacts":false}}'
node scripts/release/verify-bundle.mjs src-tauri/target/aarch64-apple-darwin/release/bundle/macos/Vidra.app
```

The check compares the bundle with the repository: version, identifier, minimum macOS version, the engine's version, and the license notices. The release workflow runs it again on the signed bundle.

## In the app

A change to the interface is checked in the running Tauri app, not only in a browser. Use a throwaway identifier, because a plain `pnpm tauri dev` writes history and the temporary-output ledger into the installed Vidra's data folder:

```sh
pnpm tauri dev --config '{"identifier":"io.github.mathieumaf.vidra.proof"}'
```

Convert only synthetic clips, into a temporary folder. Decline any offer to restore a pending queue: every development run shares one browser storage.

## What only a person can check

- **Playback.** The tests inspect an output, they do not play it. Play one whenever a change affects what is encoded.
- **The signed release.** The release workflow checks the code signature, the notarization ticket, and Gatekeeper's verdict by itself. Installing from the DMG, and installing the update once it is published, are the short list in [RELEASING.md](RELEASING.md#checks-a-person-makes).
- **VoiceOver.** The checklist is in [ACCESSIBILITY.md](ACCESSIBILITY.md).
