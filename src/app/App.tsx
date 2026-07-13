import { useState } from "react";
import { ConvertView } from "../components/convert/ConvertView";
import { DragRegion } from "../components/layout/DragRegion";
import { Sidebar } from "../components/layout/Sidebar";
import { Toolbar } from "../components/layout/Toolbar";
import { Icon } from "../components/ui/Icon";
import { HistoryView } from "../components/views/HistoryView";
import { QueueView } from "../components/views/QueueView";
import { SettingsView } from "../components/views/SettingsView";
import { QUALITY_LEVELS } from "../config/quality";
import { useEncodingQueue } from "../hooks/useEncodingQueue";
import { useFfmpegStatus } from "../hooks/useFfmpegStatus";
import type { OutputContainer, VideoCodec, View } from "../types/media";
import { viewMeta } from "./viewMeta";
import "../styles/tokens.css";
import "../styles/base.css";
import "../styles/shell.css";
import "../styles/conversion.css";
import "../styles/views.css";

export default function App() {
  const [view, setView] = useState<View>("convert");
  const [qualityIndex, setQualityIndex] = useState(2);
  const [outputContainer, setOutputContainer] = useState<OutputContainer>("mp4");
  const [videoCodec, setVideoCodec] = useState<VideoCodec>("h264");
  const { status, isReady } = useFfmpegStatus();
  const quality = QUALITY_LEVELS[qualityIndex];
  const queue = useEncodingQueue({ isReady, quality, outputContainer, videoCodec });
  const [title, subtitle] = viewMeta(view, queue.items);

  async function addVideos(preferredView: View) {
    const hadActiveJobs = queue.hasActiveJobs;
    const added = await queue.selectVideos();
    if (added > 0) setView(hadActiveJobs ? "queue" : preferredView);
  }

  async function startEncoding() {
    const queued = await queue.startEncoding();
    if (queued > 1 || queue.hasActiveJobs) setView("queue");
  }

  async function newConversion() {
    const hasOpenItems = queue.items.some((item) => (
      item.status === "ready" || item.status === "queued" || item.status === "encoding" || item.status === "paused"
    ));
    if (!hasOpenItems) queue.reset();
    await addVideos(queue.hasActiveJobs ? "queue" : "convert");
  }

  function changeOutputContainer(container: OutputContainer) {
    setOutputContainer(container);
    queue.setError(null);
  }

  function changeVideoCodec(codec: VideoCodec) {
    setVideoCodec(codec);
    queue.setError(null);
  }

  return (
    <div className={`desktop-shell${queue.isDraggingFiles ? " dragging-files" : ""}`}>
      <Sidebar
        view={view}
        status={status}
        isReady={isReady}
        queueCount={queue.queueCount}
        historyCount={queue.finishedCount}
        onViewChange={setView}
        onNewConversion={() => void newConversion()}
      />

      <section className="main-panel">
        <DragRegion className="native-titlebar" />
        <Toolbar
          view={view}
          title={title}
          subtitle={subtitle}
          hasMedia={queue.items.length > 0}
          isEncoding={queue.hasActiveJobs}
          onAddSources={() => void addVideos("convert")}
        />

        <div className="content-area">
          {view === "convert" && (
            <ConvertView
              media={queue.primaryItem?.media ?? null}
              mediaCount={queue.readyItems.length || queue.items.length}
              status={status}
              qualityIndex={qualityIndex}
              outputContainer={outputContainer}
              videoCodec={videoCodec}
              isReady={isReady}
              isProbing={queue.isProbing}
              isEncoding={queue.hasActiveJobs}
              isPaused={queue.encodingItem?.status === "paused"}
              progress={queue.currentProgress}
              result={queue.result}
              error={queue.error}
              onSelectVideo={() => void addVideos("convert")}
              onQualityChange={setQualityIndex}
              onOutputContainerChange={changeOutputContainer}
              onVideoCodecChange={changeVideoCodec}
              onStartEncoding={() => void startEncoding()}
              onTogglePause={() => queue.encodingItem && void queue.togglePause(queue.encodingItem)}
              onCancelEncoding={() => queue.encodingItem && void queue.removeOrCancel(queue.encodingItem)}
            />
          )}
          {view === "queue" && (
            <QueueView
              items={queue.items}
              quality={quality}
              outputContainer={outputContainer}
              videoCodec={videoCodec}
              isReady={isReady}
              isProbing={queue.isProbing}
              error={queue.error}
              onAddVideos={() => void addVideos("queue")}
              onStart={() => void startEncoding()}
              onRemoveOrCancel={queue.removeOrCancel}
              onTogglePause={queue.togglePause}
              onMove={queue.moveItem}
              onGoToConvert={() => setView("convert")}
            />
          )}
          {view === "history" && (
            <HistoryView items={queue.items} onGoToConvert={() => setView("convert")} />
          )}
          {view === "settings" && <SettingsView status={status} isReady={isReady} />}
        </div>
      </section>

      {queue.isDraggingFiles && (
        <div className="file-drop-overlay" aria-hidden="true">
          <div><Icon name="plus" /><strong>Add videos to the batch</strong></div>
        </div>
      )}
    </div>
  );
}
