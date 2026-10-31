import { useId } from "react";
import { audioModeLabel, videoCodecLabel } from "../../config/encoding";
import { outputResolutionLabel } from "../../config/resolution";
import {
  outputFrameRateLabel,
  type AdvancedEncodingSettings,
} from "../../config/advanced";
import type { EncodingProfile } from "../../config/profiles";
import { formatDuration, formatEta, formatFrameCount } from "../../lib/format";
import { colorConversionNotice, type ColorConversionNotice } from "../../lib/color";
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
import { useRadioGroup } from "../../hooks/useRadioGroup";
import { Icon } from "../ui/Icon";
import { LiveRegion } from "../ui/LiveRegion";
import { ProgressAnnouncer } from "../ui/ProgressAnnouncer";
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
  colorNoticeCount: number;
  blockedColorCount: number;
  isEncodingSupported: boolean;
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
  colorNoticeCount,
  blockedColorCount,
  isEncodingSupported,
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
  const pauseReasonId = useId();
  const modeOptions = [
    { id: "simple" as const, disabled: false },
    { id: "advanced" as const, disabled: false },
  ];
  const mode = useRadioGroup(modeOptions, isAdvancedMode ? "advanced" : "simple", (next) => {
    onAdvancedModeChange(next === "advanced");
  });
  const resumeBlocked = isPaused && !canResume;

  if (!media) {
    return (
      <div className="convert-view">
        <LiveRegion message={isProbing ? "Reading videos" : ""} />
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
        {status && !status.ready && <EngineUnavailable message={status.error} />}
      </div>
    );
  }

  const colorNotice = colorConversionNotice(media.video, videoCodec);

  return (
    <div className="convert-view">
      <LiveRegion message={isProbing ? "Reading videos" : ""} />
      <ProgressAnnouncer
        active={isActive}
        paused={isPaused}
        indeterminate={progress.indeterminate}
        percent={progress.percent}
      />
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
          <div
            className="conversion-mode-switch"
            role="radiogroup"
            aria-label="Conversion mode"
            onKeyDown={mode.onKeyDown}
          >
            <button
              type="button"
              className={!isAdvancedMode ? "active" : ""}
              {...mode.optionProps("simple")}
              onClick={() => onAdvancedModeChange(false)}
            >Simple</button>
            <button
              type="button"
              className={isAdvancedMode ? "active" : ""}
              {...mode.optionProps("advanced")}
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
          {colorNoticeCount > 0 && (
            <ColorConversionMessage
              notice={colorNotice}
              affectedCount={colorNoticeCount}
              blockedCount={blockedColorCount}
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
            <div className="success-message" role="status">
              <span>✓</span>
              <div>
                <strong>Encoding complete</strong>
                <p>{result.outputPath}</p>
                {result.error && <p>{result.error}</p>}
              </div>
            </div>
          )}
          {!isActive && result?.status === "cancelled" && (
            <div className="notice-message" role="status">Encoding cancelled. The partial output was removed.</div>
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
                onClick={() => {
                  if (!resumeBlocked) onTogglePause();
                }}
                aria-disabled={resumeBlocked || undefined}
                aria-describedby={resumeBlocked ? pauseReasonId : undefined}
                title={resumeBlocked ? "Pause the current encoding before resuming this video" : undefined}
              >
                {isPaused ? "Resume encoding" : "Pause encoding"}
              </button>
              {resumeBlocked && (
                <span id={pauseReasonId} className="visually-hidden">
                  Pause the current encoding before resuming this video
                </span>
              )}
              <button className="secondary-button danger-button" type="button" onClick={onCancelEncoding}>
                Cancel current
              </button>
            </div>
          ) : canEdit ? (
            <button
              className="primary-button"
              type="button"
              onClick={onStartEncoding}
              disabled={!isReady || !isEncodingSupported}
            >
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
      {status && !status.ready && <EngineUnavailable message={status.error} />}
    </div>
  );
}

function ColorConversionMessage({
  notice,
  affectedCount,
  blockedCount,
  mediaCount,
}: {
  notice: ColorConversionNotice | null;
  affectedCount: number;
  blockedCount: number;
  mediaCount: number;
}) {
  const batchNotice = mediaCount > 1 && (affectedCount > 1 || !notice);
  const isBlocking = blockedCount > 0 || notice?.blocking === true;
  return (
    <div
      className={`color-conversion-message${isBlocking ? " blocking" : ""}`}
      role={isBlocking ? "alert" : "status"}
    >
      <Icon name="warning" />
      <div>
        <strong>{batchNotice
          ? isBlocking
            ? `${blockedCount} ${blockedCount === 1 ? "video requires" : "videos require"} Original video`
            : `${affectedCount} ${affectedCount === 1 ? "video has" : "videos have"} automatic color handling`
          : notice?.title}</strong>
        <p>{batchNotice
          ? isBlocking
            ? "Edit the affected videos and choose Original video before starting this batch."
            : "H.264 creates standard SDR, H.265 and AV1 keep HDR, and Original video copies the source unchanged."
          : notice?.message}</p>
      </div>
    </div>
  );
}

function EncodingProgress({ progress, isPaused }: { progress: EncodeProgress; isPaused: boolean }) {
  const frameCount = progress.frame === null ? null : formatFrameCount(progress.frame);

  return (
    <section className="progress-panel">
      <div className="progress-heading">
        <span>{isPaused ? "Encoding paused" : "Encoding video"}</span>
        <strong>
          {progress.indeterminate
            ? isPaused ? "Paused" : "Working…"
            : `${Math.round(progress.percent)}%`}
        </strong>
      </div>
      <div
        className="progress-track"
        role="progressbar"
        aria-label="Encoding progress"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={progress.indeterminate ? undefined : Math.round(progress.percent)}
        aria-valuetext={progress.indeterminate
          ? `${formatDuration(progress.outTimeSeconds)} processed${isPaused ? ", paused" : ""}`
          : `${Math.round(progress.percent)} percent${isPaused ? ", paused" : ""}`}
      >
        <div
          className={`progress-value${progress.indeterminate ? " indeterminate" : ""}${isPaused ? " paused" : ""}`}
          style={progress.indeterminate ? undefined : { width: `${progress.percent}%` }}
        />
      </div>
      <div className="progress-meta">
        {progress.indeterminate ? (
          <>
            <span>
              {formatDuration(progress.outTimeSeconds)} processed
              {frameCount ? ` · ${frameCount}` : ""}
            </span>
            <span>
              {formatDuration(progress.elapsedSeconds)} elapsed
              {!isPaused && progress.speed ? ` · ${progress.speed}` : ""}
            </span>
          </>
        ) : (
          <>
            <span>{formatDuration(progress.outTimeSeconds)} processed</span>
            <span>{isPaused ? "Paused" : <>{progress.speed ? `${progress.speed} · ` : ""}{formatEta(progress.etaSeconds)}</>}</span>
          </>
        )}
      </div>
    </section>
  );
}

function EngineUnavailable({ message }: { message?: string | null }) {
  return (
    <div className="error-message" role="alert">
      {message || (
        <>
          FFmpeg is not available. Run <code>pnpm ffmpeg:prepare</code> and restart Vidra.
        </>
      )}
    </div>
  );
}
