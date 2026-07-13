import { formatBitrate, formatDuration, formatEta } from "../../lib/format";
import type { EncodeFinished, EncodeProgress, FfmpegStatus, MediaInfo } from "../../types/media";
import type { OutputContainer, VideoCodec } from "../../types/media";
import { Icon } from "../ui/Icon";
import { EncodingOptions } from "./EncodingOptions";
import { MediaSourceCard } from "./MediaSourceCard";
import { QualitySlider } from "./QualitySlider";

type ConvertViewProps = {
  media: MediaInfo | null;
  status: FfmpegStatus | null;
  qualityIndex: number;
  outputContainer: OutputContainer;
  videoCodec: VideoCodec;
  isReady: boolean;
  isProbing: boolean;
  isEncoding: boolean;
  progress: EncodeProgress;
  result: EncodeFinished | null;
  error: string | null;
  onSelectVideo: () => void;
  onQualityChange: (qualityIndex: number) => void;
  onOutputContainerChange: (container: OutputContainer) => void;
  onVideoCodecChange: (codec: VideoCodec) => void;
  onStartEncoding: () => void;
  onCancelEncoding: () => void;
};

export function ConvertView({
  media,
  status,
  qualityIndex,
  outputContainer,
  videoCodec,
  isReady,
  isProbing,
  isEncoding,
  progress,
  result,
  error,
  onSelectVideo,
  onQualityChange,
  onOutputContainerChange,
  onVideoCodecChange,
  onStartEncoding,
  onCancelEncoding,
}: ConvertViewProps) {
  if (!media) {
    return (
      <div className="convert-view">
        <div className="empty-convert">
          <div className="empty-heading">
            <span>LOCAL VIDEO ENCODING</span>
            <h2>Convert video without giving up your files.</h2>
            <p>Private, content-aware compression powered by FFmpeg.</p>
          </div>
          <button
            className="file-picker"
            type="button"
            onClick={onSelectVideo}
            disabled={!isReady || isProbing}
          >
            <span className="file-icon"><Icon name="file" /></span>
            <span className="picker-title">{isProbing ? "Reading video…" : "Choose a video"}</span>
            <span className="picker-copy">MP4, MOV, MKV, WebM, AVI and more</span>
            <span className="picker-action">Browse files</span>
          </button>
        </div>
        {error && <div className="error-message" role="alert">{error}</div>}
        {status && !status.ready && <EngineUnavailable />}
      </div>
    );
  }

  const primaryAudio = media.audio[0] ?? null;
  const audioWillCopy =
    media.audio.length > 0 &&
    (outputContainer === "mkv" || media.audio.every((stream) => stream.codec.toLowerCase() === "aac"));

  return (
    <div className="convert-view">
      <div className="conversion-workspace">
        <MediaSourceCard media={media} />
        <EncodingOptions
          container={outputContainer}
          videoCodec={videoCodec}
          disabled={isEncoding}
          onContainerChange={onOutputContainerChange}
          onVideoCodecChange={onVideoCodecChange}
        />
        <QualitySlider
          qualityIndex={qualityIndex}
          videoCodec={videoCodec}
          disabled={isEncoding}
          onChange={onQualityChange}
        />

        <section className="audio-card">
          <div className="audio-icon">♪</div>
          <div>
            <span className="section-label">AUDIO PROTECTION</span>
            <strong>
              {outputContainer === "mkv" && audioWillCopy
                ? "All audio tracks preserved"
                : audioWillCopy
                  ? "Original audio preserved"
                  : "Source bitrate protected"}
            </strong>
            <p>
              {outputContainer === "mkv" && audioWillCopy
                ? "MKV keeps the original audio without quality loss. Compatible subtitles, metadata and chapters are preserved."
                : audioWillCopy
                ? `Compatible AAC audio will be copied without quality loss${primaryAudio ? ` · ${formatBitrate(primaryAudio.bitRate)}` : ""}.`
                : "Audio conversion will never exceed the known source bitrate."}
            </p>
          </div>
        </section>

        {isEncoding && <EncodingProgress progress={progress} />}
        {result?.status === "completed" && (
          <div className="success-message">
            <span>✓</span>
            <div><strong>Encoding complete</strong><p>{result.outputPath}</p></div>
          </div>
        )}
        {result?.status === "cancelled" && (
          <div className="notice-message">Encoding cancelled. The partial output was removed.</div>
        )}
        {error && <div className="error-message" role="alert">{error}</div>}

        <div className="conversion-actions">
          <span>Output <strong>{outputContainer.toUpperCase()} · {videoCodec === "h264" ? "H.264" : "H.265"}</strong></span>
          {isEncoding ? (
            <button className="secondary-button" type="button" onClick={onCancelEncoding}>
              Cancel encoding
            </button>
          ) : (
            <button className="primary-button" type="button" onClick={onStartEncoding} disabled={!isReady}>
              Choose output and encode <span>→</span>
            </button>
          )}
        </div>
      </div>
      {status && !status.ready && <EngineUnavailable />}
    </div>
  );
}

function EncodingProgress({ progress }: { progress: EncodeProgress }) {
  return (
    <section className="progress-panel">
      <div className="progress-heading">
        <span>Encoding video</span>
        <strong>{Math.round(progress.percent)}%</strong>
      </div>
      <div className="progress-track">
        <div className="progress-value" style={{ width: `${progress.percent}%` }} />
      </div>
      <div className="progress-meta">
        <span>{formatDuration(progress.outTimeSeconds)} processed</span>
        <span>{progress.speed ? `${progress.speed} · ` : ""}{formatEta(progress.etaSeconds)}</span>
      </div>
    </section>
  );
}

function EngineUnavailable() {
  return (
    <div className="error-message" role="alert">
      FFmpeg is not available. Run <code>pnpm ffmpeg:prepare</code> and restart Vidra.
    </div>
  );
}
