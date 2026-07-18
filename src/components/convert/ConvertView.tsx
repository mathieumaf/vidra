import { audioModeLabel, videoCodecLabel } from "../../config/encoding";
import { outputResolutionLabel } from "../../config/resolution";
import {
  outputFrameRateLabel,
  type AdvancedEncodingSettings,
} from "../../config/advanced";
import type { EncodingProfile } from "../../config/profiles";
import { formatDuration, formatEta } from "../../lib/format";
import { colorConversionRisk, type ColorConversionRisk } from "../../lib/color";
import type { EncodeFinished, EncodeProgress, FfmpegStatus, MediaInfo } from "../../types/media";
import type {
  AudioMode,
  AudioTrackMode,
  EncodingSpeed,
  OutputContainer,
  OutputResolution,
  VideoCodec,
  TrackSelection,
} from "../../types/media";
import { Icon } from "../ui/Icon";
import { AudioOptions } from "./AudioOptions";
import { EncodingOptions } from "./EncodingOptions";
import { MediaSourceCard } from "./MediaSourceCard";
import { MediaDetails } from "./MediaDetails";
import { QualitySlider } from "./QualitySlider";
import { ResolutionOptions } from "./ResolutionOptions";
import { AdvancedOptions } from "./AdvancedOptions";
import { ProfileBar } from "./ProfileBar";
import { TrackSelectionOptions } from "./TrackSelectionOptions";

type ConvertViewProps = {
  media: MediaInfo | null;
  mediaCount: number;
  status: FfmpegStatus | null;
  qualityIndex: number;
  outputContainer: OutputContainer;
  videoCodec: VideoCodec;
  encodingSpeed: EncodingSpeed;
  audioMode: AudioMode;
  outputResolution: OutputResolution;
  isAdvancedMode: boolean;
  advancedSettings: AdvancedEncodingSettings;
  trackSelection: TrackSelection;
  profiles: EncodingProfile[];
  selectedProfileId: string | null;
  isProfileModified: boolean;
  readyItemCount: number;
  colorRiskCount: number;
  isReady: boolean;
  isProbing: boolean;
  isActive: boolean;
  canEdit: boolean;
  canResume: boolean;
  isPaused: boolean;
  progress: EncodeProgress;
  result: EncodeFinished | null;
  error: string | null;
  onSelectVideo: () => void;
  onQualityChange: (qualityIndex: number) => void;
  onOutputContainerChange: (container: OutputContainer) => void;
  onVideoCodecChange: (codec: VideoCodec) => void;
  onEncodingSpeedChange: (speed: EncodingSpeed) => void;
  onAudioModeChange: (mode: AudioMode) => void;
  onOutputResolutionChange: (resolution: OutputResolution) => void;
  onAdvancedModeChange: (advanced: boolean) => void;
  onAdvancedSettingsChange: (settings: Partial<AdvancedEncodingSettings>) => void;
  onAudioTrackSelectionChange: (indexes: number[], strategy?: AudioTrackMode) => void;
  onSubtitleTrackSelectionChange: (indexes: number[]) => void;
  onProfileSelect: (profileId: string | null) => void;
  onProfileCreate: (name: string) => void;
  onProfileUpdate: () => void;
  onProfileRename: (name: string) => void;
  onProfileDelete: () => void;
  onApplyProfileToAll: () => void;
  onStartEncoding: () => void;
  onTogglePause: () => void;
  onCancelEncoding: () => void;
};

export function ConvertView({
  media,
  mediaCount,
  status,
  qualityIndex,
  outputContainer,
  videoCodec,
  encodingSpeed,
  audioMode,
  outputResolution,
  isAdvancedMode,
  advancedSettings,
  trackSelection,
  profiles,
  selectedProfileId,
  isProfileModified,
  readyItemCount,
  colorRiskCount,
  isReady,
  isProbing,
  isActive,
  canEdit,
  canResume,
  isPaused,
  progress,
  result,
  error,
  onSelectVideo,
  onQualityChange,
  onOutputContainerChange,
  onVideoCodecChange,
  onEncodingSpeedChange,
  onAudioModeChange,
  onOutputResolutionChange,
  onAdvancedModeChange,
  onAdvancedSettingsChange,
  onAudioTrackSelectionChange,
  onSubtitleTrackSelectionChange,
  onProfileSelect,
  onProfileCreate,
  onProfileUpdate,
  onProfileRename,
  onProfileDelete,
  onApplyProfileToAll,
  onStartEncoding,
  onTogglePause,
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
            <span className="picker-title">{isProbing ? "Reading videos…" : "Choose videos"}</span>
            <span className="picker-copy">Select or drop one or more videos</span>
            <span className="picker-action">Browse files</span>
          </button>
        </div>
        {error && <div className="error-message" role="alert">{error}</div>}
        {status && !status.ready && <EngineUnavailable />}
      </div>
    );
  }

  const colorRisk = colorConversionRisk(media.video, videoCodec);

  return (
    <div className="convert-view">
      <div className="conversion-workspace">
        <div className="conversion-content">
          <MediaSourceCard media={media} count={mediaCount} />
          <ProfileBar
            profiles={profiles}
            selectedProfileId={selectedProfileId}
            isModified={isProfileModified}
            readyItemCount={readyItemCount}
            disabled={!canEdit}
            onSelect={onProfileSelect}
            onCreate={onProfileCreate}
            onUpdate={onProfileUpdate}
            onRename={onProfileRename}
            onDelete={onProfileDelete}
            onApplyToAll={onApplyProfileToAll}
          />
          <div className="conversion-mode-switch" role="radiogroup" aria-label="Conversion mode">
            <button
              type="button"
              role="radio"
              aria-checked={!isAdvancedMode}
              className={!isAdvancedMode ? "active" : ""}
              onClick={() => onAdvancedModeChange(false)}
            >Simple</button>
            <button
              type="button"
              role="radio"
              aria-checked={isAdvancedMode}
              className={isAdvancedMode ? "active" : ""}
              onClick={() => onAdvancedModeChange(true)}
            >Advanced</button>
          </div>
          {isAdvancedMode && (
            <>
              <MediaDetails media={media} />
              <TrackSelectionOptions
                audio={media.audio}
                subtitles={media.subtitles}
                container={outputContainer}
                audioMode={audioMode}
                selection={trackSelection}
                disabled={!canEdit}
                onAudioChange={onAudioTrackSelectionChange}
                onSubtitleChange={onSubtitleTrackSelectionChange}
              />
            </>
          )}
          <EncodingOptions
            container={outputContainer}
            videoCodec={videoCodec}
            encodingSpeed={encodingSpeed}
            disabled={!canEdit}
            onContainerChange={onOutputContainerChange}
            onVideoCodecChange={onVideoCodecChange}
            onEncodingSpeedChange={onEncodingSpeedChange}
          />
          {colorRiskCount > 0 && (
            <ColorRiskWarning
              risk={colorRisk}
              affectedCount={colorRiskCount}
              mediaCount={mediaCount}
            />
          )}
          <QualitySlider
            qualityIndex={qualityIndex}
            videoCodec={videoCodec}
            encodingSpeed={encodingSpeed}
            disabled={!canEdit}
            onChange={onQualityChange}
          />

          <ResolutionOptions
            video={media.video}
            resolution={outputResolution}
            videoCodec={videoCodec}
            disabled={!canEdit}
            onChange={onOutputResolutionChange}
          />

          <AudioOptions
            audio={media.audio}
            container={outputContainer}
            mode={audioMode}
            disabled={!canEdit}
            onChange={onAudioModeChange}
          />

          {isAdvancedMode && (
            <AdvancedOptions
              video={media.video}
              audio={media.audio}
              videoCodec={videoCodec}
              audioMode={audioMode}
              settings={advancedSettings}
              disabled={!canEdit}
              onChange={onAdvancedSettingsChange}
            />
          )}

          {!isActive && result?.status === "completed" && (
            <div className="success-message">
              <span>✓</span>
              <div><strong>Encoding complete</strong><p>{result.outputPath}</p></div>
            </div>
          )}
          {!isActive && result?.status === "cancelled" && (
            <div className="notice-message">Encoding cancelled. The partial output was removed.</div>
          )}
          {error && <div className="error-message" role="alert">{error}</div>}
        </div>

        {isActive && <EncodingProgress progress={progress} isPaused={isPaused} />}

        <div className="conversion-actions">
          <span>
            Output <strong>
              {outputContainer.toUpperCase()} · {videoCodecLabel(videoCodec)} · {outputResolutionLabel(outputResolution)}
              {advancedSettings.outputFrameRate !== "source" ? ` · ${outputFrameRateLabel(advancedSettings.outputFrameRate)}` : ""}
              {audioMode === "none" || trackSelection.audioStreamIndexes.length === 0
                ? " · No audio"
                : ` · ${audioModeLabel(audioMode)} audio`}
            </strong>
          </span>
          {isActive ? (
            <div className="conversion-action-buttons">
              <button
                className="secondary-button"
                type="button"
                onClick={onTogglePause}
                disabled={isPaused && !canResume}
                title={isPaused && !canResume ? "Pause the current encoding before resuming this video" : undefined}
              >
                {isPaused ? "Resume encoding" : "Pause encoding"}
              </button>
              <button className="secondary-button danger-button" type="button" onClick={onCancelEncoding}>
                Cancel current
              </button>
            </div>
          ) : canEdit ? (
            <button className="primary-button" type="button" onClick={onStartEncoding} disabled={!isReady}>
              {mediaCount > 1 ? `Choose folder and encode ${mediaCount} videos` : "Choose output and encode"} <span>→</span>
            </button>
          ) : result ? (
            <span className="queued-action-copy">{
              result.status === "completed"
                ? "Encoding complete"
                : result.status === "cancelled"
                  ? "Encoding cancelled"
                  : "Encoding failed"
            }</span>
          ) : (
            <span className="queued-action-copy">Waiting in the queue</span>
          )}
        </div>
      </div>
      {status && !status.ready && <EngineUnavailable />}
    </div>
  );
}

function ColorRiskWarning({
  risk,
  affectedCount,
  mediaCount,
}: {
  risk: ColorConversionRisk | null;
  affectedCount: number;
  mediaCount: number;
}) {
  const batchWarning = mediaCount > 1 && (affectedCount > 1 || !risk);
  return (
    <div className="color-risk-message" role="status" aria-live="polite">
      <Icon name="warning" />
      <div>
        <strong>{batchWarning
          ? `${affectedCount} ${affectedCount === 1 ? "video may" : "videos may"} have color changes`
          : risk?.title}</strong>
        <p>{batchWarning
          ? "HDR, high-bit-depth, or wide-gamut sources will be re-encoded. Review each video or choose Original video to preserve its video stream."
          : risk?.message}</p>
      </div>
    </div>
  );
}

function EncodingProgress({ progress, isPaused }: { progress: EncodeProgress; isPaused: boolean }) {
  return (
    <section className="progress-panel">
      <div className="progress-heading">
        <span>{isPaused ? "Encoding paused" : "Encoding video"}</span>
        <strong>{Math.round(progress.percent)}%</strong>
      </div>
      <div className="progress-track">
        <div className="progress-value" style={{ width: `${progress.percent}%` }} />
      </div>
      <div className="progress-meta">
        <span>{formatDuration(progress.outTimeSeconds)} processed</span>
        <span>{isPaused ? "Paused" : <>{progress.speed ? `${progress.speed} · ` : ""}{formatEta(progress.etaSeconds)}</>}</span>
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
