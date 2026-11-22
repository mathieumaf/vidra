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
- The **core** validates every request again, owns the conversion queue, and starts the engine. It decides every file operation: it creates the temporary output, publishes it under its final name, and removes what is unfinished.
- The **engine** is the FFmpeg and FFprobe build that Vidra bundles. The core starts it with a list of arguments, never through a shell. FFmpeg reads the source and writes the media into the temporary file the core created. How the engine is built and pinned is in [RELEASING.md](RELEASING.md#the-ffmpeg-engine).

Media never leaves these three processes. The network is used for three things only: the update check, the download of the update it announces, and the two GitHub links in Settings.

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
| `app/` | `App.tsx`: composition, navigation, wiring. It also holds the settings being edited and the rules between options. | No domain workflow and no IPC call here. |
| `components/` | What is drawn. `convert/`, `views/` (queue, history, settings), `layout/`, `queue/`, `update/`, `error/`, `ui/` | Presentational. State comes in as props. |
| `hooks/` | Stateful workflows and event subscriptions. `useEncodingQueue` is the main one. | One workflow per hook. |
| `services/` | One function per Tauri command | The only place that imports `invoke`. |
| `lib/` | Pure helpers: formatting, queue rules, trim arithmetic, color and HDR classification | No React, no IPC. Easy to test. |
| `config/` | Static product choices: containers, codecs, quality levels, resolutions, advanced defaults, built-in profiles | Labels and options live here, not in components. |
| `types/` | The shapes shared with the core: `media.ts`, and `applicationUpdate.ts` for the update response | Field names mirror the Rust serialization exactly. |
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
3. **Pick a destination.** For one video, the save panel returns a path, and asks first when that name is taken. For several, the user picks a folder, and the interface adds a number to any name already used there (`lib/queue.ts`).
4. **Queue.** The interface sends `EncodeRequest` values with `enqueueEncodes`. The core validates each one again, probes the source again, checks the settings against the media (`encode::validate_settings`), checks free space, and adds a `PendingJob` to the `JobManager`.
5. **Start.** `startEncodeQueue` takes the job at the front of the queue. A paused job is resumed. A waiting job is started: the core creates a temporary file in the destination folder (`output/partial.rs`), records it in the ledger, prepares the trim if any, builds the arguments (`encode::command_arguments`), and starts FFmpeg. One encode runs at a time.
6. **Follow.** `queue.rs` reads FFmpeg's progress and emits `encode-progress`. The interface can pause, resume, or cancel the active job, and reorder or remove the waiting ones. Removing a waiting job reports it as cancelled and writes no history entry.
7. **Finish.** A trim that copies the original video may first run a second FFmpeg pass that puts the clipped subtitles back. On success, `output::partial::finalize_output` moves the temporary file to the final name, or keeps the finished video under another name when that name is no longer available. On failure or cancellation, it removes the temporary file, and a removal that fails is tried again at the next launch. The core writes a history entry and emits `encode-finished`, then starts the next job.

The source file is only ever read. The exact publication and cleanup rules, with their limits, are in the [threat model](security/threat-model.md#sensitive-data-flows-and-privileged-actions).

## The contract between interface and core

**Commands** are registered in `lib.rs` and wrapped one to one in `src/services/`. Most are implemented in `commands/mod.rs`. Three sit next to the code they serve, in `open_files.rs` and `application_update.rs`.

| Command | Service | Purpose |
| --- | --- | --- |
| `get_ffmpeg_status` | `encoding.ts` | Is the pinned engine ready? |
| `probe_media` | `encoding.ts` | Inspect one file. |
| `segment_keyframe` | `encoding.ts` | Where a trimmed copy of the original video would really start. |
| `enqueue_encodes` | `encoding.ts` | Validate requests and add them to the queue. |
| `start_encode_queue` | `encoding.ts` | Start or resume the job at the front of the queue. |
| `cancel_encode`, `set_encode_paused`, `move_queued_encode` | `encoding.ts` | Control the queue. |
| `list_conversion_history`, `delete_history_entry`, `clear_conversion_history`, `reveal_history_output` | `history.ts` | History. |
| `reveal_output_file`, `list_destination_files`, `take_opened_files` | `files.ts` | Finder, destination folder, files opened from outside. |
| `save_diagnostic_report` | `diagnostics.ts` | Save a failure report as a new `.txt` file. |
| `check_application_update`, `install_application_update` | `updates.ts` | Updates. |

**Events** go from the core to the interface.

| Event | Payload defined in |
| --- | --- |
| `encode-started`, `encode-progress`, `encode-finished`, `encode-pause-changed` | `ffmpeg/types.rs` |
| `history-entry-created` | `history/types.rs` (`HistoryEntry`) |
| `open-files` | `open_files.rs` (`OpenFilesPayload`) |

Each payload is mirrored in `src/types/media.ts`.

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

The app data folder is `~/Library/Application Support/io.github.mathieumaf.vidra/`. Saved data outlives the code that wrote it. Stored profiles and the pending queue are both checked by `isEncodingSettings` in `src/config/profiles.ts`, which rejects a value it does not know: an entry saved before a field existed, or with a value that was later removed, is dropped unless that function is taught to accept it.

## How to

These recipes list every place the change touches today. The Rust compiler flags a missing arm in an exhaustive `match`. Nothing flags a missing entry in the TypeScript lists named below, or a test such as `container === "mp4"` that a new value lands on the wrong side of, so follow the list.

### Add an encoding option

The output frame rate is the example to follow. `git grep -n "outputFrameRate\|output_frame_rate"` shows every place it touches.

1. **Core type.** Add the enum and the `EncodeRequest` field in `ffmpeg/types.rs`.
2. **Arguments.** Produce the FFmpeg arguments in `ffmpeg/encode/video.rs` or `audio.rs`, with a unit test of the exact argument list. Refuse impossible combinations in `validate_settings`.
3. **Where the core reports settings.** Add it to `HistorySettings` in `history/types.rs`, with a serde default so old history files still load, and assign it in `HistoryDraft::from_job`. Add it to `settings_summary` in `diagnostics.rs`. If it changes the output size, add it to the estimate in `ffmpeg/disk_space.rs`.
4. **Shared type.** Mirror it in `EncodingSettings` in `src/types/media.ts` and in `EncodeRequest` in `src/services/encoding.ts`.
5. **Choices, labels, defaults.** Add the option list to `src/config/`. An advanced option also goes in `AdvancedEncodingSettings`, `DEFAULT_ADVANCED_SETTINGS`, and `advancedSettings` in `src/config/advanced.ts`, which is where the built-in profiles get its value.
6. **Stored settings.** In `src/config/profiles.ts`, add it to `settingKeys` (or two profiles that differ only by it compare as equal), to `validValues`, to `isEncodingSettings`, and to `compatibleProfileSettings` if it depends on the source. Decide what a profile or a pending queue saved before the option existed becomes, and add a test with such an old value.
7. **Interface.** `src/app/App.tsx` holds the setting being edited and the rules between options, such as resetting it when the video is copied. Add the control to a component in `src/components/convert/`. `useEncodingQueue` copies the value into the request.
8. **Summaries.** Show it where settings are summarised: `ConvertView.tsx`, `QueueView.tsx`, and `src/lib/history.ts`.
9. **Corpus.** If the option changes what the encoder produces, add a case to `ffmpeg/corpus.rs` so a real encode proves it.

### Add a command

1. Write the logic in the domain module, returning `ApiResult<T>`.
2. Add a thin `#[tauri::command]` in `commands/mod.rs` and register it in `lib.rs`.
3. Wrap it in one function in `src/services/`, and call that from a hook.
4. Validate every argument in Rust. A path from the interface is untrusted, even when the interface already checked it.

### Add a video codec

1. **Engine.** Check the license. If the encoder is not in the engine, add it to the recipe, to the encoder check in `scripts/ffmpeg/build.mjs`, and to `THIRD_PARTY_NOTICES.md` and `src/config/legal.ts`, which is what Settings shows. That means a new engine archive: see [RELEASING.md](RELEASING.md#the-ffmpeg-engine).
2. **Core.** Add the variant to `VideoCodec` in `ffmpeg/types.rs`, the arguments in `ffmpeg/encode/video.rs`, and the stream mapping rules in `ffmpeg/encode.rs`. The compiler then asks for a value for each quality level in `QualityLevel::crf`, in the same file as `VideoCodec`, and for the codec in the size estimate in `ffmpeg/disk_space.rs`. A quality value comes with a test. Say what happens to HDR.
3. **Interface.** Mirror it in `src/types/media.ts` and `src/config/encoding.ts`, and add it to `validValues.videoCodec` in `src/config/profiles.ts`, or saved profiles and a restored queue that use it are dropped. Check the codec rules in `src/app/App.tsx`, `src/components/convert/EncodingOptions.tsx`, `compatibleProfileSettings` in `src/config/profiles.ts`, and `src/lib/color.ts`, which assumes that every codec except the copy and H.264 keeps 10-bit HDR.
4. **Tests.** Add the encoder to `REQUIRED_ENCODERS` and the codec to the matrix and the output assertions in `ffmpeg/corpus.rs`.
5. **Documentation.** [FORMATS.md](FORMATS.md).

### Add an output container

1. **Core.** Add the variant and its extension to `OutputContainer` in `ffmpeg/types.rs`. Most container rules are `==` tests, which the compiler does not flag, so visit each one: `git grep -n "OutputContainer::" -- src-tauri/src`. They are the subtitle mapping in `ffmpeg/encode.rs`, the audio that can be copied in `ffmpeg/encode/audio.rs`, the video that can be copied and the MP4 flags and codec tags in `ffmpeg/encode/video.rs`, and the trimming branches in `ffmpeg/segment.rs` and `ffmpeg/queue.rs`. `output/partial.rs` knows the extensions as text: `create_partial_supported` refuses to create a temporary output with another extension, so every conversion into the new container fails, and `is_partial_name` does not recognise such a file as Vidra's own. Say what happens to audio, subtitles, chapters, and metadata the container cannot hold.
2. **Interface.** Mirror it in `src/types/media.ts` and `src/config/encoding.ts`, and add it to `validValues.container` in `src/config/profiles.ts`. The interface repeats the core's compatibility rules as tests on one container, so a new one silently takes a side of each: `git grep -n -E '=== "(mp4|mkv)"' -- src`. They are in `src/app/App.tsx`, in `AudioOptions.tsx` and `TrackSelectionOptions.tsx` under `src/components/convert/`, in `compatibleProfileSettings`, and in `src/lib/tracks.ts`. Without a change there, the track picker offers a new container the subtitles that MP4 can hold.
3. **Tests.** Add it to the matrix and the output assertions in `ffmpeg/corpus.rs`.
4. **Documentation.** [FORMATS.md](FORMATS.md).

Accepting a new file type as a source is a separate change. The list of extensions is in three places that must agree: `SUPPORTED_VIDEO_EXTENSIONS` in `open_files.rs`, `supportedExtensions` in `src/hooks/useEncodingQueue.ts`, and `fileAssociations` in `src-tauri/tauri.conf.json`.

### Add something to Settings

Add the row to `src/components/views/SettingsView.tsx`, keep its state in a hook, and persist it the way the neighbouring preference does. The view gets everything through props from `App.tsx`.

## What to read next

- [TESTING.md](TESTING.md): the test layers and how to add to each.
- [RELEASING.md](RELEASING.md): the workflows, the release steps, and the engine.
- [security/threat-model.md](security/threat-model.md): untrusted inputs, trust boundaries, and known limits.
