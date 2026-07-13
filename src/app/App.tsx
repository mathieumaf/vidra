import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open, save } from "@tauri-apps/plugin-dialog";
import { ConvertView } from "../components/convert/ConvertView";
import { Sidebar } from "../components/layout/Sidebar";
import { Toolbar } from "../components/layout/Toolbar";
import { DragRegion } from "../components/layout/DragRegion";
import { HistoryView } from "../components/views/HistoryView";
import { QueueView } from "../components/views/QueueView";
import { SettingsView } from "../components/views/SettingsView";
import { QUALITY_LEVELS } from "../config/quality";
import { defaultOutputPath, errorMessage } from "../lib/format";
import type {
  EncodeFinished,
  EncodeProgress,
  FfmpegStatus,
  MediaInfo,
  View,
} from "../types/media";
import "../styles/tokens.css";
import "../styles/base.css";
import "../styles/shell.css";
import "../styles/conversion.css";
import "../styles/views.css";

const initialProgress: EncodeProgress = {
  jobId: "",
  percent: 0,
  outTimeSeconds: 0,
  speed: null,
  frame: null,
};

const titles: Record<View, (media: MediaInfo | null, isEncoding: boolean) => [string, string]> = {
  convert: (media) => ["Convert", media ? media.name : "Start a local video conversion"],
  queue: (_, isEncoding) => ["Queue", isEncoding ? "One encoding job is running" : "No active encoding jobs"],
  history: () => ["History", "Recent conversions from this session"],
  settings: () => ["Settings", "Application and encoding engine"],
};

export default function App() {
  const [view, setView] = useState<View>("convert");
  const [status, setStatus] = useState<FfmpegStatus | null>(null);
  const [media, setMedia] = useState<MediaInfo | null>(null);
  const [qualityIndex, setQualityIndex] = useState(2);
  const [isProbing, setIsProbing] = useState(false);
  const [jobId, setJobId] = useState<string | null>(null);
  const [progress, setProgress] = useState(initialProgress);
  const [result, setResult] = useState<EncodeFinished | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void invoke<FfmpegStatus>("get_ffmpeg_status")
      .then(setStatus)
      .catch((engineError) => {
        setStatus({ ready: false, ffmpegVersion: null, ffprobeVersion: null, error: errorMessage(engineError) });
      });

    const subscriptions = Promise.all([
      listen<EncodeProgress>("encode-progress", ({ payload }) => setProgress(payload)),
      listen<EncodeFinished>("encode-finished", ({ payload }) => {
        setResult(payload);
        setJobId(null);
        if (payload.status === "failed") {
          setError(payload.error ?? "FFmpeg could not complete the encode.");
        }
      }),
    ]);

    return () => void subscriptions.then((unlisten) => unlisten.forEach((dispose) => dispose()));
  }, []);

  const quality = QUALITY_LEVELS[qualityIndex];
  const isEncoding = jobId !== null;
  const isReady = status?.ready === true;
  const [title, subtitle] = titles[view](media, isEncoding);

  async function selectVideo() {
    setError(null);
    setResult(null);
    const selected = await open({
      multiple: false,
      directory: false,
      title: "Choose a video",
      filters: [
        {
          name: "Video files",
          extensions: ["mp4", "mov", "mkv", "webm", "avi", "m4v", "mts", "m2ts"],
        },
      ],
    });
    if (!selected) return;

    setIsProbing(true);
    setView("convert");
    try {
      setMedia(await invoke<MediaInfo>("probe_media", { path: selected }));
      setProgress(initialProgress);
    } catch (probeError) {
      setError(errorMessage(probeError));
    } finally {
      setIsProbing(false);
    }
  }

  async function startEncoding() {
    if (!media || !isReady) return;
    setError(null);
    setResult(null);
    const outputPath = await save({
      title: "Save encoded video",
      defaultPath: defaultOutputPath(media.path),
      filters: [{ name: "MPEG-4 video", extensions: ["mp4"] }],
    });
    if (!outputPath) return;

    try {
      const id = await invoke<string>("start_encode", {
        request: {
          inputPath: media.path,
          outputPath,
          quality: quality.id,
        },
      });
      setProgress({ ...initialProgress, jobId: id });
      setJobId(id);
    } catch (encodeError) {
      setError(errorMessage(encodeError));
    }
  }

  async function cancelEncoding() {
    if (!jobId) return;
    try {
      await invoke("cancel_encode", { jobId });
    } catch (cancelError) {
      setError(errorMessage(cancelError));
    }
  }

  function newConversion() {
    if (isEncoding) return;
    setMedia(null);
    setResult(null);
    setError(null);
    setProgress(initialProgress);
    setView("convert");
  }

  return (
    <div className="desktop-shell">
      <Sidebar
        view={view}
        status={status}
        isReady={isReady}
        isEncoding={isEncoding}
        result={result}
        onViewChange={setView}
        onNewConversion={newConversion}
      />

      <section className="main-panel">
        <DragRegion className="native-titlebar" />
        <Toolbar
          view={view}
          title={title}
          subtitle={subtitle}
          hasMedia={media !== null}
          isEncoding={isEncoding}
          onReplaceSource={selectVideo}
        />

        <div className="content-area">
          {view === "convert" && (
            <ConvertView
              media={media}
              status={status}
              qualityIndex={qualityIndex}
              isReady={isReady}
              isProbing={isProbing}
              isEncoding={isEncoding}
              progress={progress}
              result={result}
              error={error}
              onSelectVideo={selectVideo}
              onQualityChange={setQualityIndex}
              onStartEncoding={startEncoding}
              onCancelEncoding={cancelEncoding}
            />
          )}
          {view === "queue" && (
            <QueueView
              isEncoding={isEncoding}
              media={media}
              quality={quality}
              progress={progress}
              onCancel={cancelEncoding}
              onGoToConvert={() => setView("convert")}
            />
          )}
          {view === "history" && (
            <HistoryView result={result} media={media} onGoToConvert={() => setView("convert")} />
          )}
          {view === "settings" && <SettingsView status={status} isReady={isReady} />}
        </div>
      </section>
    </div>
  );
}
