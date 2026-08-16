import { useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { confirm, open, save } from "@tauri-apps/plugin-dialog";
import type { QualityLevel } from "../config/quality";
import { outputContainer as getOutputContainer } from "../config/encoding";
import { resolutionReducesVideo } from "../config/resolution";
import {
  frameRateReducesVideo,
  type AdvancedEncodingSettings,
} from "../config/advanced";
import { defaultOutputPath, errorMessage } from "../lib/format";
import { colorConversionNotice } from "../lib/color";
import {
  batchOutputPaths,
  createQueueItem,
  defaultTrackSelection,
  emptyProgress,
  normalizedTrackSelection,
  TERMINAL_JOB_STATUSES,
} from "../lib/queue";
import {
  clearPendingQueue,
  loadPendingQueue,
  savePendingQueue,
  type PendingQueueEntry,
  type PendingQueueSnapshot,
} from "../lib/pendingQueue";
import { rememberedQueueItems, rememberQueueItems } from "../lib/queueSession";
import {
  cancelEncode,
  enqueueEncodes,
  moveQueuedEncode,
  probeMedia,
  setEncodePaused,
  startEncodeQueue,
} from "../services/encoding";
import { listDestinationFiles, revealOutputFile } from "../services/files";
import type {
  AudioMode,
  EncodingSpeed,
  EncodingSettings,
  EncodeFinished,
  EncodePauseChanged,
  EncodeProgress,
  EncodeQueueItem,
  EncodeStarted,
  OutputContainer,
  OutputResolution,
  QueuedEncode,
  TrackSelection,
  VideoCodec,
} from "../types/media";

const supportedExtensions = new Set(["mp4", "mov", "mkv", "webm", "avi", "m4v", "mts", "m2ts"]);
const WORKING_JOB_STATUSES = new Set(["queued", "encoding", "paused"]);
const INSUFFICIENT_DISK_SPACE = "insufficient_disk_space";

function hasErrorCode(error: unknown, code: string): boolean {
  return error !== null
    && typeof error === "object"
    && "code" in error
    && (error as { code?: unknown }).code === code;
}

function promoteWorkingItem(items: EncodeQueueItem[], clientId: string): EncodeQueueItem[] {
  const index = items.findIndex((item) => item.clientId === clientId);
  const firstWorking = items.findIndex((item) => WORKING_JOB_STATUSES.has(item.status));
  if (index < 0 || firstWorking < 0 || index <= firstWorking) return items;

  const next = [...items];
  const [item] = next.splice(index, 1);
  next.splice(firstWorking, 0, item);
  return next;
}

type EncodingQueueOptions = {
  isReady: boolean;
  quality: QualityLevel;
  outputContainer: OutputContainer;
  videoCodec: VideoCodec;
  encodingSpeed: EncodingSpeed;
  audioMode: AudioMode;
  outputResolution: OutputResolution;
  advancedSettings: AdvancedEncodingSettings;
};

export function useEncodingQueue({
  isReady,
  quality,
  outputContainer,
  videoCodec,
  encodingSpeed,
  audioMode,
  outputResolution,
  advancedSettings,
}: EncodingQueueOptions) {
  // Restored so recovering from an interface failure keeps the queue in view
  // while the conversions themselves keep running in the background.
  const [items, setItems] = useState<EncodeQueueItem[]>(rememberedQueueItems);
  const [isProbing, setIsProbing] = useState(false);
  const [result, setResult] = useState<EncodeFinished | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [isDraggingFiles, setIsDraggingFiles] = useState(false);
  const [restoreOffer, setRestoreOffer] = useState<PendingQueueSnapshot | null>(() => (
    rememberedQueueItems().length === 0 ? loadPendingQueue() : null
  ));
  const [isRestoring, setIsRestoring] = useState(false);
  const [selectedClientId, setSelectedClientId] = useState<string | null>(null);
  const defaultSettingsRef = useRef<EncodingSettings>({
    quality: quality.id,
    container: outputContainer,
    videoCodec,
    encodingSpeed,
    audioMode,
    outputResolution,
    ...advancedSettings,
  });

  useEffect(() => {
    defaultSettingsRef.current = {
      quality: quality.id,
      container: outputContainer,
      videoCodec,
      encodingSpeed,
      audioMode,
      outputResolution,
      ...advancedSettings,
    };
  }, [
    quality.id,
    outputContainer,
    videoCodec,
    encodingSpeed,
    audioMode,
    outputResolution,
    advancedSettings,
  ]);

  useEffect(() => {
    rememberQueueItems(items);
    if (!restoreOffer) savePendingQueue(items);
  }, [items, restoreOffer]);

  useEffect(() => {
    const subscriptions = Promise.all([
      listen<EncodeStarted>("encode-started", ({ payload }) => {
        setItems((current) => {
          const item = current.find((candidate) => candidate.jobId === payload.jobId);
          const updated = current.map((candidate) => (
            candidate.jobId === payload.jobId
              ? { ...candidate, status: "encoding" as const, progress: emptyProgress(payload.jobId) }
              : candidate
          ));
          return item ? promoteWorkingItem(updated, item.clientId) : updated;
        });
      }),
      listen<EncodePauseChanged>("encode-pause-changed", ({ payload }) => {
        setItems((current) => {
          const item = current.find((candidate) => candidate.jobId === payload.jobId);
          const updated = current.map((candidate) => (
            candidate.jobId === payload.jobId
              ? { ...candidate, status: payload.paused ? "paused" as const : "encoding" as const }
              : candidate
          ));
          return !payload.paused && item
            ? promoteWorkingItem(updated, item.clientId)
            : updated;
        });
      }),
      listen<EncodeProgress>("encode-progress", ({ payload }) => {
        setItems((current) => current.map((item) => (
          item.jobId === payload.jobId
            ? {
                ...item,
                status: item.status === "paused" ? "paused" : "encoding",
                progress: payload,
              }
            : item
        )));
      }),
      listen<EncodeFinished>("encode-finished", ({ payload }) => {
        setResult(payload);
        setItems((current) => current.map((item) => (
          item.jobId === payload.jobId
            ? {
                ...item,
                status: payload.status,
                outputPath: payload.outputPath,
                error: payload.error,
                diagnostic: payload.diagnostic,
                progress: payload.status === "completed"
                  ? { ...item.progress, percent: 100, etaSeconds: 0 }
                  : item.progress,
              }
            : item
        )));
        if (payload.status === "failed") {
          setError(payload.error ?? "FFmpeg could not complete the encode.");
        }
      }),
    ]);

    return () => void subscriptions.then((unlisten) => unlisten.forEach((dispose) => dispose()));
  }, []);

  useEffect(() => {
    const listener = getCurrentWebview().onDragDropEvent(({ payload }) => {
      if (payload.type === "enter" || payload.type === "over") {
        setIsDraggingFiles(true);
      } else if (payload.type === "leave") {
        setIsDraggingFiles(false);
      } else {
        setIsDraggingFiles(false);
        void addVideoPaths(payload.paths);
      }
    });

    return () => void listener.then((unlisten) => unlisten());
  }, []);

  const readyItems = items.filter((item) => item.status === "ready");
  const activeItems = items.filter((item) => (
    item.status === "queued" || item.status === "encoding" || item.status === "paused"
  ));
  const encodingItem = items.find((item) => item.status === "encoding") ?? null;
  const queueControlItem = encodingItem ?? items.find((item) => (
    item.status === "paused" || item.status === "queued"
  )) ?? null;
  const selectedItem = items.find((item) => item.clientId === selectedClientId) ?? null;
  const primaryItem = selectedItem ?? readyItems[0] ?? encodingItem ?? items[0] ?? null;
  const hasActiveJobs = activeItems.length > 0;
  const queueCount = activeItems.length + readyItems.length;

  async function selectVideos(settingsOverride?: EncodingSettings): Promise<number> {
    setError(null);
    setResult(null);
    const selected = await open({
      multiple: true,
      directory: false,
      title: "Choose videos",
      filters: [
        {
          name: "Video files",
          extensions: [...supportedExtensions],
        },
      ],
    });
    if (!selected) return 0;
    return addVideoPaths(Array.isArray(selected) ? selected : [selected], settingsOverride);
  }

  async function addVideoPaths(
    selectedPaths: string[],
    settingsOverride?: EncodingSettings,
  ): Promise<number> {
    const paths = selectedPaths.filter((path) => {
      const extension = path.split(".").pop()?.toLowerCase() ?? "";
      return supportedExtensions.has(extension);
    });
    if (paths.length === 0) return 0;

    setIsProbing(true);
    try {
      const probes = await Promise.allSettled(paths.map(probeMedia));
      const media = probes.flatMap((probe) => probe.status === "fulfilled" ? [probe.value] : []);
      const failures = probes.length - media.length;
      const newItems = media.map((item) => {
        const defaults = settingsOverride ?? defaultSettingsRef.current;
        let settings = defaults.outputResolution !== "source"
          && !resolutionReducesVideo(item.video, defaults.outputResolution)
          ? { ...defaults, outputResolution: "source" as const }
          : defaults;
        if (
          settings.outputFrameRate !== "source"
          && !frameRateReducesVideo(item.video, settings.outputFrameRate)
        ) {
          settings = { ...settings, outputFrameRate: "source" };
        }
        return createQueueItem(item, settings);
      });
      setItems((currentItems) => {
        const base = currentItems.every((item) => TERMINAL_JOB_STATUSES.has(item.status))
          ? []
          : currentItems;
        return [...base, ...newItems];
      });
      if (newItems.length > 0) setSelectedClientId(newItems[0].clientId);
      if (failures > 0) {
        setError(`${failures} ${failures === 1 ? "file could" : "files could"} not be read.`);
      }
      return media.length;
    } catch (probeError) {
      setError(errorMessage(probeError));
      return 0;
    } finally {
      setIsProbing(false);
    }
  }

  async function restorePendingQueue(): Promise<number> {
    if (!restoreOffer || !isReady || isRestoring) return 0;
    const entries = restoreOffer.entries;
    setIsRestoring(true);
    setError(null);
    setResult(null);
    try {
      const probes = await Promise.allSettled(entries.map((entry) => probeMedia(entry.sourcePath)));
      const restoredItems = probes.flatMap((probe, index) => {
        if (probe.status !== "fulfilled") return [];
        const entry = entries[index];
        return [{
          ...createQueueItem(probe.value, entry.settings),
          trackSelection: normalizedTrackSelection(probe.value, entry.trackSelection),
        }];
      });
      const droppedEntries = entries.filter((_, index) => probes[index].status === "rejected");

      setItems((currentItems) => {
        const base = currentItems.every((item) => TERMINAL_JOB_STATUSES.has(item.status))
          ? []
          : currentItems;
        return [...base, ...restoredItems];
      });
      if (restoredItems.length > 0) setSelectedClientId(restoredItems[0].clientId);
      setNotice(restoreNotice(restoredItems.length, droppedEntries));
      clearPendingQueue();
      setRestoreOffer(null);
      return restoredItems.length;
    } finally {
      setIsRestoring(false);
    }
  }

  function discardPendingQueue() {
    clearPendingQueue();
    setRestoreOffer(null);
  }

  async function startEncoding(): Promise<number> {
    if (readyItems.length === 0 || !isReady) return 0;
    const blocked = readyItems.find((item) => (
      colorConversionNotice(item.media.video, item.settings.videoCodec)?.blocking
    ));
    if (blocked) {
      setError(`${blocked.media.name} requires Original video because its Dolby Vision structure cannot be safely re-encoded.`);
      return 0;
    }
    const shouldStartQueue = activeItems.length === 0;
    setError(null);
    setResult(null);
    setNotice(null);
    let outputPaths: string[];
    let replaceExisting = false;

    if (readyItems.length === 1) {
      const item = readyItems[0];
      const container = getOutputContainer(item.settings.container);
      const matchingSources = items.filter((candidate) => (
        candidate.clientId !== item.clientId &&
        candidate.media.path === item.media.path &&
        candidate.settings.container === item.settings.container
      )).length;
      const outputPath = await save({
        title: "Save encoded video",
        defaultPath: defaultOutputPath(
          item.media.path,
          item.settings.container,
          matchingSources + 1,
        ),
        filters: [{ name: container.filterName, extensions: [container.extension] }],
      });
      if (!outputPath) return 0;
      outputPaths = [outputPath];
      replaceExisting = true;
    } else {
      const directory = await open({
        multiple: false,
        directory: true,
        title: `Choose a folder for ${readyItems.length} encoded videos`,
      });
      if (!directory || Array.isArray(directory)) return 0;
      try {
        const destinationFiles = await listDestinationFiles(directory);
        const plan = await batchOutputPaths(
          readyItems,
          directory,
          items.flatMap((item) => item.outputPath ? [item.outputPath] : []),
          destinationFiles,
        );
        outputPaths = plan.paths;
        if (plan.renamedCount > 0) {
          const names = plan.renamedCount === 1 ? "name" : "names";
          setNotice(
            `Added a number to ${plan.renamedCount} output ${names} so nothing in the destination folder is replaced.`,
          );
        }
      } catch (destinationError) {
        setError(errorMessage(destinationError));
        return 0;
      }
    }

    const requests = readyItems.map((item, index) => ({
      inputPath: item.media.path,
      outputPath: outputPaths[index],
      quality: item.settings.quality,
      container: item.settings.container,
      videoCodec: item.settings.videoCodec,
      encodingSpeed: item.settings.encodingSpeed,
      audioMode: item.settings.audioMode,
      outputResolution: item.settings.outputResolution,
      outputFrameRate: item.settings.outputFrameRate,
      qualityTuning: item.settings.qualityTuning,
      audioBitrate: item.settings.audioBitrate,
      audioChannels: item.settings.audioChannels,
      audioTrackMode: item.settings.audioTrackMode,
      audioStreamIndexes: item.trackSelection.audioStreamIndexes,
      subtitleStreamIndexes: item.trackSelection.subtitleStreamIndexes,
      preserveSubtitles: item.settings.preserveSubtitles,
      preserveMetadata: item.settings.preserveMetadata,
      preserveChapters: item.settings.preserveChapters,
      replaceExisting,
      allowInsufficientDiskSpace: false,
    }));

    try {
      let queued: QueuedEncode[];
      try {
        queued = await enqueueEncodes(requests);
      } catch (enqueueError) {
        if (!hasErrorCode(enqueueError, INSUFFICIENT_DISK_SPACE)) throw enqueueError;
        const proceed = await confirm(errorMessage(enqueueError), {
          title: "Not enough destination space",
          kind: "warning",
          okLabel: "Proceed anyway",
          cancelLabel: "Choose another destination",
        });
        if (!proceed) return 0;
        queued = await enqueueEncodes(requests.map((request) => ({
          ...request,
          allowInsufficientDiskSpace: true,
        })));
      }
      const jobsByClientId = new Map(
        readyItems.map((item, index) => [item.clientId, queued[index]]),
      );
      setItems((current) => current.map((item) => {
        const job = jobsByClientId.get(item.clientId);
        return job
          ? {
              ...item,
              jobId: job.jobId,
              outputPath: job.outputPath,
              status: "queued",
              progress: emptyProgress(job.jobId),
            }
          : item;
      }));
      setSelectedClientId(null);
      if (shouldStartQueue) await startEncodeQueue();
      return queued.length;
    } catch (encodeError) {
      setError(errorMessage(encodeError));
      return 0;
    }
  }

  async function removeOrCancel(item: EncodeQueueItem) {
    if (item.status === "ready") {
      setItems((current) => current.filter((candidate) => candidate.clientId !== item.clientId));
      if (selectedClientId === item.clientId) setSelectedClientId(null);
      return;
    }
    if (!item.jobId || !["queued", "encoding", "paused"].includes(item.status)) return;

    try {
      await cancelEncode(item.jobId);
      if (item.status === "queued") {
        setItems((current) => current.filter((candidate) => candidate.clientId !== item.clientId));
      }
    } catch (cancelError) {
      setError(errorMessage(cancelError));
    }
  }

  async function revealOutput(item: EncodeQueueItem) {
    if (item.status !== "completed") return;
    if (!item.outputPath) {
      setError("The output file location is unavailable.");
      return;
    }

    setError(null);
    try {
      await revealOutputFile(item.outputPath);
    } catch (revealError) {
      setError(errorMessage(revealError));
    }
  }

  async function togglePause(item: EncodeQueueItem) {
    if (!item.jobId || (item.status !== "encoding" && item.status !== "paused")) return;
    if (item.status === "paused" && encodingItem) {
      setError("Pause the current encoding before resuming this video.");
      return;
    }
    const paused = item.status !== "paused";
    setItems((current) => {
      const updated = current.map((candidate) => (
        candidate.jobId === item.jobId
          ? { ...candidate, status: paused ? "paused" as const : "encoding" as const }
          : candidate
      ));
      return paused ? updated : promoteWorkingItem(updated, item.clientId);
    });
    try {
      await setEncodePaused(item.jobId, paused);
    } catch (pauseError) {
      setItems((current) => current.map((candidate) => (
        candidate.jobId === item.jobId
          ? { ...candidate, status: paused ? "encoding" : "paused" }
          : candidate
      )));
      setError(errorMessage(pauseError));
    }
  }

  async function toggleQueue() {
    if (!queueControlItem) return;
    if (queueControlItem.status === "encoding") {
      await togglePause(queueControlItem);
      return;
    }
    if (queueControlItem.status !== "paused" && queueControlItem.status !== "queued") return;

    setError(null);
    try {
      await startEncodeQueue();
    } catch (startError) {
      setError(errorMessage(startError));
    }
  }

  function selectItem(item: EncodeQueueItem) {
    setSelectedClientId(item.clientId);
  }

  function updateItemSettings(
    item: EncodeQueueItem,
    settings: EncodingSettings,
    applyTrackDefaults = false,
  ) {
    if (item.status !== "ready") return;
    setItems((current) => current.map((candidate) => (
      candidate.clientId === item.clientId
        ? {
            ...candidate,
            settings: { ...settings },
            trackSelection: applyTrackDefaults
              ? defaultTrackSelection(candidate.media, settings)
              : candidate.trackSelection,
          }
        : candidate
    )));
  }

  function updateItemTrackSelection(
    item: EncodeQueueItem,
    patch: Partial<TrackSelection>,
  ) {
    if (item.status !== "ready") return;
    setItems((current) => current.map((candidate) => {
      if (candidate.clientId !== item.clientId) return candidate;
      return {
        ...candidate,
        trackSelection: normalizedTrackSelection(candidate.media, {
          ...candidate.trackSelection,
          ...patch,
        }),
      };
    }));
  }

  async function moveItem(item: EncodeQueueItem, direction: -1 | 1) {
    const isWaiting = item.status === "queued" || item.status === "paused";
    if (item.status !== "ready" && !isWaiting) return;
    if (isWaiting && item.jobId) {
      try {
        await moveQueuedEncode(item.jobId, direction);
      } catch (moveError) {
        setError(errorMessage(moveError));
        return;
      }
    }

    setItems((current) => {
      const index = current.findIndex((candidate) => candidate.clientId === item.clientId);
      let destination = index + direction;
      const isDestination = (candidate: EncodeQueueItem) => item.status === "ready"
        ? candidate.status === "ready"
        : candidate.status === "queued" || candidate.status === "paused";
      while (
        destination >= 0 &&
        destination < current.length &&
        !isDestination(current[destination])
      ) {
        destination += direction;
      }
      if (destination < 0 || destination >= current.length) return current;
      const next = [...current];
      [next[index], next[destination]] = [next[destination], next[index]];
      return next;
    });
  }

  function reset() {
    setItems([]);
    setSelectedClientId(null);
    setResult(null);
    setError(null);
    setNotice(null);
  }

  return {
    items,
    readyItems,
    activeItems,
    encodingItem,
    queueControlItem,
    currentProgress: primaryItem?.progress ?? emptyProgress(),
    primaryItem,
    hasActiveJobs,
    queueCount,
    isProbing,
    isDraggingFiles,
    restoreOffer,
    isRestoring,
    result,
    error,
    notice,
    selectVideos,
    restorePendingQueue,
    discardPendingQueue,
    startEncoding,
    revealOutput,
    removeOrCancel,
    togglePause,
    toggleQueue,
    moveItem,
    selectItem,
    updateItemSettings,
    updateItemTrackSelection,
    reset,
    setError,
  };
}

function restoreNotice(restoredCount: number, droppedEntries: PendingQueueEntry[]): string {
  const restored = restoredCount === 1 ? "1 video" : `${restoredCount} videos`;
  if (droppedEntries.length === 0) {
    return `Restored ${restored} with saved settings. Choose where to save ${restoredCount === 1 ? "it" : "them"} when you start encoding.`;
  }

  const names = droppedEntries.map((entry) => `“${entry.sourceName}”`).join(", ");
  const unavailable = droppedEntries.length === 1
    ? `Could not restore ${names} because its source file is no longer available at the saved location.`
    : `Could not restore ${names} because their source files are no longer available at the saved locations.`;
  return restoredCount > 0
    ? `Restored ${restored} with saved settings. ${unavailable}`
    : unavailable;
}
