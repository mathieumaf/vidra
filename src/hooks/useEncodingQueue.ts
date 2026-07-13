import { useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { open, save } from "@tauri-apps/plugin-dialog";
import type { QualityLevel } from "../config/quality";
import { outputContainer as getOutputContainer } from "../config/encoding";
import { defaultOutputPath, errorMessage } from "../lib/format";
import {
  batchOutputPaths,
  createQueueItem,
  emptyProgress,
  TERMINAL_JOB_STATUSES,
} from "../lib/queue";
import {
  cancelEncode,
  enqueueEncodes,
  moveQueuedEncode,
  probeMedia,
  setEncodePaused,
  startEncodeQueue,
} from "../services/encoding";
import type {
  EncodeFinished,
  EncodePauseChanged,
  EncodeProgress,
  EncodeQueueItem,
  EncodeStarted,
  OutputContainer,
  VideoCodec,
} from "../types/media";

const supportedExtensions = new Set(["mp4", "mov", "mkv", "webm", "avi", "m4v", "mts", "m2ts"]);

type EncodingQueueOptions = {
  isReady: boolean;
  quality: QualityLevel;
  outputContainer: OutputContainer;
  videoCodec: VideoCodec;
};

export function useEncodingQueue({
  isReady,
  quality,
  outputContainer,
  videoCodec,
}: EncodingQueueOptions) {
  const [items, setItems] = useState<EncodeQueueItem[]>([]);
  const [isProbing, setIsProbing] = useState(false);
  const [result, setResult] = useState<EncodeFinished | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isDraggingFiles, setIsDraggingFiles] = useState(false);
  const itemsRef = useRef(items);

  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  useEffect(() => {
    const subscriptions = Promise.all([
      listen<EncodeStarted>("encode-started", ({ payload }) => {
        setItems((current) => current.map((item) => (
          item.jobId === payload.jobId
            ? { ...item, status: "encoding", progress: emptyProgress(payload.jobId) }
            : item
        )));
      }),
      listen<EncodePauseChanged>("encode-pause-changed", ({ payload }) => {
        setItems((current) => current.map((item) => (
          item.jobId === payload.jobId
            ? { ...item, status: payload.paused ? "paused" : "encoding" }
            : item
        )));
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
  const encodingItem = items.find((item) => item.status === "encoding" || item.status === "paused") ?? null;
  const primaryItem = readyItems[0] ?? encodingItem ?? items[0] ?? null;
  const hasActiveJobs = activeItems.length > 0;
  const queueCount = activeItems.length + readyItems.length;
  const finishedCount = items.filter((item) => TERMINAL_JOB_STATUSES.has(item.status)).length;

  async function selectVideos(): Promise<number> {
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
    return addVideoPaths(Array.isArray(selected) ? selected : [selected]);
  }

  async function addVideoPaths(selectedPaths: string[]): Promise<number> {
    const current = itemsRef.current;
    const currentPaths = current.every((item) => TERMINAL_JOB_STATUSES.has(item.status))
      ? new Set<string>()
      : new Set(current.map((item) => item.media.path));
    const paths = selectedPaths.filter((path) => {
      const extension = path.split(".").pop()?.toLowerCase() ?? "";
      return supportedExtensions.has(extension) && !currentPaths.has(path);
    });
    if (paths.length === 0) return 0;

    setIsProbing(true);
    try {
      const probes = await Promise.allSettled(paths.map(probeMedia));
      const media = probes.flatMap((probe) => probe.status === "fulfilled" ? [probe.value] : []);
      const failures = probes.length - media.length;
      setItems((currentItems) => {
        const base = currentItems.every((item) => TERMINAL_JOB_STATUSES.has(item.status))
          ? []
          : currentItems;
        return [...base, ...media.map(createQueueItem)];
      });
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

  async function startEncoding(): Promise<number> {
    if (readyItems.length === 0 || !isReady) return 0;
    setError(null);
    setResult(null);
    const container = getOutputContainer(outputContainer);
    let outputPaths: string[];

    if (readyItems.length === 1) {
      const outputPath = await save({
        title: "Save encoded video",
        defaultPath: defaultOutputPath(readyItems[0].media.path, outputContainer),
        filters: [{ name: container.filterName, extensions: [container.extension] }],
      });
      if (!outputPath) return 0;
      outputPaths = [outputPath];
    } else {
      const directory = await open({
        multiple: false,
        directory: true,
        title: `Choose a folder for ${readyItems.length} encoded videos`,
      });
      if (!directory || Array.isArray(directory)) return 0;
      outputPaths = await batchOutputPaths(readyItems, directory, outputContainer);
    }

    try {
      const queued = await enqueueEncodes(readyItems.map((item, index) => ({
        inputPath: item.media.path,
        outputPath: outputPaths[index],
        quality: quality.id,
        container: outputContainer,
        videoCodec,
      })));
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
      await startEncodeQueue();
      return queued.length;
    } catch (encodeError) {
      setError(errorMessage(encodeError));
      return 0;
    }
  }

  async function removeOrCancel(item: EncodeQueueItem) {
    if (item.status === "ready") {
      setItems((current) => current.filter((candidate) => candidate.clientId !== item.clientId));
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

  async function togglePause(item: EncodeQueueItem) {
    if (!item.jobId || (item.status !== "encoding" && item.status !== "paused")) return;
    const paused = item.status !== "paused";
    setItems((current) => current.map((candidate) => (
      candidate.jobId === item.jobId
        ? { ...candidate, status: paused ? "paused" : "encoding" }
        : candidate
    )));
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

  async function moveItem(item: EncodeQueueItem, direction: -1 | 1) {
    if (item.status !== "ready" && item.status !== "queued") return;
    if (item.status === "queued" && item.jobId) {
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
      while (destination >= 0 && destination < current.length && current[destination].status !== item.status) {
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
    setResult(null);
    setError(null);
  }

  return {
    items,
    readyItems,
    activeItems,
    encodingItem,
    currentProgress: encodingItem?.progress ?? emptyProgress(),
    primaryItem,
    hasActiveJobs,
    queueCount,
    finishedCount,
    isProbing,
    isDraggingFiles,
    result,
    error,
    selectVideos,
    startEncoding,
    removeOrCancel,
    togglePause,
    moveItem,
    reset,
    setError,
  };
}
