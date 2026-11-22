# Architecture

This is the map of Vidra's code: what runs where, where each kind of code lives, how a conversion travels through it, and which files to touch for common changes. The rules that keep it this way are in [AGENTS.md](../AGENTS.md).

## Three processes

```text
┌──────────────────────┐  commands   ┌───────────────────────┐  argument list  ┌──────────────────┐
│ Interface            │ ──────────► │ Core                  │ ──────────────► │ Engine           │
│ React in the WebView │ ◄────────── │ Rust, built on Tauri  │ ◄────────────── │ ffmpeg, ffprobe  │
│ src/                 │   events    │ src-tauri/src/        │ progress, JSON  │ bundled sidecars │
└──────────────────────┘             └───────────────────────┘                 └──────────────────┘
        shows and asks                 owns files, queue, processes               reads and writes media
```

- The **interface** holds what the user is editing: the selected videos, their settings, profiles. It never touches a file. It asks the core.
- The **core** validates every request again, owns the conversion queue, starts the engine, and is the only code that writes or removes files.
- The **engine** is the FFmpeg and FFprobe build that Vidra bundles. The core starts it with a list of arguments, never through a shell. How it is built and pinned is in [RELEASING.md](RELEASING.md#the-ffmpeg-engine).

Media never leaves these three processes. The only network use is the update check.

## Repository map

```text
src/                    the interface (TypeScript, React)
src-tauri/src/          the core (Rust)
src-tauri/binaries/     the engine, installed by pnpm ffmpeg:prepare (ignored by Git)
src-tauri/capabilities/ what the interface is allowed to call
src-tauri/tauri*.conf.json  window, bundle, updater configuration
scripts/ffmpeg/         the engine: recipe, pin, install, compile, package
scripts/release/        release checks: version, notes, bundle, update manifest, update feed
scripts/corpus/         generator of the synthetic test clips
scripts/ci/             tests of the workflow files
scripts/icons/          macOS icon preparation
.github/                workflows, the shared setup action, issue and pull request templates
docs/                   this documentation
```

## The interface: `src/`

| Folder | Holds | Rule |
| --- | --- | --- |
| `app/` | `App.tsx`: composition, navigation, wiring | No domain workflow and no IPC call here. |
| `components/` | What is drawn. `convert/`, `views/` (queue, history, settings), `layout/`, `queue/`, `update/`, `error/`, `ui/` | Presentational. State comes in as props. |
| `hooks/` | Stateful workflows and event subscriptions. `useEncodingQueue` is the main one. | One workflow per hook. |
| `services/` | One function per Tauri command | The only place that imports `invoke`. |
| `lib/` | Pure helpers: formatting, queue rules, trim arithmetic, color and HDR classification | No React, no IPC. Easy to test. |
| `config/` | Static product choices: containers, codecs, quality levels, resolutions, built-in profiles | Labels and options live here, not in components. |
| `types/` | `media.ts`: every shape shared with the core | Field names mirror the Rust serialization exactly. |
| `styles/` | CSS. `tokens.css` holds the design tokens. | Reuse tokens. |
| `test/` | Test helpers: a mount function and fixtures | |

## The core: `src-tauri/src/`

| Module | Responsibility |
| --- | --- |
| `lib.rs` | Starts the app, registers the commands, handles opened files and quit. |
| `commands/` | Thin Tauri commands. They validate the boundary and delegate. |
| `ffmpeg/types.rs` | The request and media types, shared with `src/types/media.ts`. |
| `ffmpeg/paths.rs` | Validation of source and output paths. |
| `ffmpeg/probe.rs` | Runs FFprobe and parses its JSON into `MediaInfo`. |
| `ffmpeg/encode.rs`, `ffmpeg/encode/` | Builds the FFmpeg argument list: stream mapping, video (`video.rs`), audio (`audio.rs`). |
| `ffmpeg/trim.rs`, `ffmpeg/segment.rs` | Segment trimming: seek arguments, keyframe lookup, subtitle and chapter handling. |
| `ffmpeg/queue.rs` | Runs the queue: starts FFmpeg, follows its progress, finishes or fails the job, emits events. |
| `ffmpeg/progress.rs` | Parses FFmpeg's progress output and estimates the time remaining. |
| `ffmpeg/disk_space.rs` | Estimates the output size and checks free space. |
| `ffmpeg/binary.rs`, `ffmpeg/version.rs` | Finds the engine and checks that it is the pinned version. |
| `ffmpeg/corpus.rs` | The end-to-end conversion test. Test code only. |
| `jobs/` | The queue's state: waiting, active, and paused jobs behind one mutex. Process control. |
| `output/` | The temporary output, its publication under the final name, and cleanup of unfinished files. |
| `history/` | The conversion history file. |
| `diagnostics.rs` | The failure report: FFmpeg's last lines, with paths redacted. |
| `application_update.rs` | Update check and installation. |
| `open_files.rs` | Files opened from Finder or a second launch. |
| `power.rs` | Keeps the Mac awake while a conversion runs. |
| `error.rs` | `ApiError`: a stable `code` and an English `message`. |

## The life of a conversion

1. **Open.** The user picks or drops a file. `useEncodingQueue` calls `probeMedia`. The core validates the path (`paths.rs`), runs FFprobe, and returns a `MediaInfo`.
2. **Choose.** The interface holds an `EncodeQueueItem` with `EncodingSettings`, the track selection, and an optional trim. `lib/` and `config/` decide what is possible: for example, H.264 is refused for an HDR source whose transfer characteristic is unknown.
3. **Queue.** The user picks a destination in the save panel. The interface sends `EncodeRequest` values with `enqueueEncodes`. The core validates each one again, probes the source again, checks the settings against the media (`encode::validate_settings`), checks free space, and adds a `PendingJob` to the `JobManager`.
4. **Start.** `startEncodeQueue` takes the next job. The core creates a temporary file in the destination folder (`output/partial.rs`), records it in the ledger, builds the arguments (`encode::command_arguments`), and starts FFmpeg. One encode runs at a time.
5. **Follow.** `queue.rs` reads FFmpeg's progress and emits `encode-progress`. The interface can pause, resume, or cancel the active job, and reorder or remove the waiting ones.
6. **Finish.** On success, `output::partial::finalize_output` moves the temporary file to the final name. On failure or cancellation, it removes the temporary file. The core writes a history entry and emits `encode-finished`, then starts the next job.

The source file is only ever read.

## The contract between interface and core

**Commands** are registered in `lib.rs` and wrapped one to one in `src/services/`. Most are implemented in `commands/mod.rs`. Three sit next to the code they serve, in `open_files.rs` and `application_update.rs`.

| Command | Service | Purpose |
| --- | --- | --- |
| `get_ffmpeg_status` | `encoding.ts` | Is the pinned engine ready? |
| `probe_media` | `encoding.ts` | Inspect one file. |
| `segment_keyframe` | `encoding.ts` | Where a trimmed copy of the original video would really start. |
| `enqueue_encodes` | `encoding.ts` | Validate requests and add them to the queue. |
| `start_encode_queue` | `encoding.ts` | Start the next waiting job. |
| `cancel_encode`, `set_encode_paused`, `move_queued_encode` | `encoding.ts` | Control the queue. |
| `list_conversion_history`, `delete_history_entry`, `clear_conversion_history`, `reveal_history_output` | `history.ts` | History. |
| `reveal_output_file`, `list_destination_files`, `take_opened_files` | `files.ts` | Finder, destination folder, files opened from outside. |
| `save_diagnostic_report` | `diagnostics.ts` | Save a failure report as a new `.txt` file. |
| `check_application_update`, `install_application_update` | `updates.ts` | Updates. |

**Events** go from the core to the interface: `encode-started`, `encode-progress`, `encode-finished`, `encode-pause-changed`, `history-entry-created`, and `open-files`. Their payloads are in `ffmpeg/types.rs` and `src/types/media.ts`.

**Errors** are `ApiError` values. The `code` is stable and the interface may branch on it. The `message` is English text for the user.

What the interface may call beyond these commands is listed in `src-tauri/capabilities/default.json`.

## Where state lives

| State | Where | Notes |
| --- | --- | --- |
| The queue | Memory, in `JobManager` | Gone when the app quits. |
| Waiting videos, for the restore offer | `localStorage`, `vidra.pending-queue.v1` | Restoring validates every item again and starts nothing. |
| Personal profiles and the default profile | `localStorage`, `vidra.encoding-profiles.v1` and `vidra.encoding-profile-preferences.v1` | |
| Theme | `localStorage`, `vidra.theme-preference` | |
| History | `conversion-history.json` in the app data folder | |
| Unfinished temporary outputs | `partial-outputs.json` in the app data folder | Lets the next launch remove what a crash left behind. |

The app data folder is `~/Library/Application Support/io.github.mathieumaf.vidra/`. Saved data outlives the code that wrote it: a new field needs a default when an old file or an old stored value is read.

## How to

### Add an encoding option

The output frame rate is a complete example. Search for `outputFrameRate` and `output_frame_rate` to see every place it touches.

1. **Core type.** Add the enum and the `EncodeRequest` field in `ffmpeg/types.rs`. Give the field a serde default if old data can omit it.
2. **Arguments.** Produce the FFmpeg arguments in `ffmpeg/encode/video.rs` or `audio.rs`, with a unit test of the exact argument list. Refuse impossible combinations in `validate_settings`.
3. **History.** Add it to `HistorySettings` in `history/types.rs`, with a default, so old history files still load.
4. **Shared type.** Mirror it in `src/types/media.ts` (`EncodingSettings`) and in `EncodeRequest` in `src/services/encoding.ts`.
5. **Choices and labels.** Add the option list to `src/config/`. Add it to the built-in profiles in `src/config/profiles.ts`. That file also checks stored profiles, so decide what a profile saved before the option existed becomes.
6. **Interface.** Add the control to a component in `src/components/convert/`, and pass the value through `useEncodingQueue`, which builds the request.
7. **Corpus.** If the option changes what the encoder produces, add a case to `ffmpeg/corpus.rs` so a real encode proves it.

### Add a command

1. Write the logic in the domain module, returning `ApiResult<T>`.
2. Add a thin `#[tauri::command]` in `commands/mod.rs` and register it in `lib.rs`.
3. Wrap it in one function in `src/services/`, and call that from a hook.
4. Validate every argument in Rust. A path from the interface is untrusted, even when the interface already checked it.

### Add a codec or a container

1. Check the license and add the encoder to the engine recipe if it is not there. That means a new engine archive: see [RELEASING.md](RELEASING.md#the-ffmpeg-engine).
2. Add the variant in `ffmpeg/types.rs`, the arguments in `ffmpeg/encode/`, and the stream mapping rules in `ffmpeg/encode.rs`. Say what happens to audio, subtitles, chapters, and HDR metadata the container cannot hold.
3. Add it to `REQUIRED_ENCODERS` and to the matrix in `ffmpeg/corpus.rs`.
4. Mirror it in `src/types/media.ts` and `src/config/encoding.ts`, and document it in [FORMATS.md](FORMATS.md) and `THIRD_PARTY_NOTICES.md`.

### Add something to Settings

Add the row to `src/components/views/SettingsView.tsx`, keep its state in a hook, and persist it the way the neighbouring preference does. The view gets everything through props from `App.tsx`.

## What to read next

- [TESTING.md](TESTING.md): the test layers and how to add to each.
- [RELEASING.md](RELEASING.md): the workflows, the release steps, and the engine.
- [security/threat-model.md](security/threat-model.md): untrusted inputs, trust boundaries, and known limits.
