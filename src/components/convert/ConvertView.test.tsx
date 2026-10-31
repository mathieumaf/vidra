import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_ADVANCED_SETTINGS } from "../../config/advanced";
import { BUILT_IN_PROFILES } from "../../config/profiles";
import { ConvertView } from "./ConvertView";
import type { MediaInfo } from "../../types/media";

const media: MediaInfo = {
  path: "/tmp/input.mp4",
  name: "input.mp4",
  durationSeconds: 2,
  sizeBytes: 22_000,
  formatName: "mov,mp4",
  formatLongName: "QuickTime / MOV",
  video: {
    codec: "h264",
    width: 640,
    height: 360,
    frameRate: 30,
    pixelFormat: "yuv420p",
    bitDepth: 8,
    colorRange: "tv",
    colorSpace: "bt709",
    colorTransfer: "bt709",
    colorPrimaries: "bt709",
    hdrFormat: null,
    dolbyVision: null,
  },
  audio: [],
  subtitles: [],
  chapterCount: 0,
  chapters: [],
  hasMetadata: false,
};

describe("ConvertView", () => {
  it("shows a completed job as complete instead of queued", () => {
    const noop = vi.fn();
    const markup = renderToStaticMarkup(
      <ConvertView
        media={media}
        mediaCount={1}
        status={{ ready: true, ffmpegVersion: "ffmpeg version 8.1.3", ffprobeVersion: "ffprobe version 8.1.3", error: null }}
        qualityIndex={2}
        outputContainer="mp4"
        videoCodec="h264"
        encodingSpeed="efficient"
        audioMode="auto"
        outputResolution="source"
        isAdvancedMode={false}
        advancedSettings={DEFAULT_ADVANCED_SETTINGS}
        trackSelection={{ audioStreamIndexes: [], subtitleStreamIndexes: [] }}
        trim={null}
        copyStartSeconds={null}
        segmentError={null}
        profiles={[BUILT_IN_PROFILES[0]]}
        selectedProfileId={BUILT_IN_PROFILES[0].id}
        isProfileModified={false}
        readyItemCount={0}
        colorNoticeCount={0}
        blockedColorCount={0}
        isEncodingSupported
        isReady
        isProbing={false}
        isActive={false}
        canEdit={false}
        canResume={false}
        isPaused={false}
        progress={{
          jobId: "job-1",
          percent: 100,
          indeterminate: false,
          elapsedSeconds: 2,
          outTimeSeconds: 2,
          speed: null,
          etaSeconds: 0,
          frame: null,
        }}
        result={{ jobId: "job-1", status: "completed", outputPath: "/tmp/output.mp4", error: null, diagnostic: null }}
        error={null}
        onSelectVideo={noop}
        onQualityChange={noop}
        onOutputContainerChange={noop}
        onVideoCodecChange={noop}
        onEncodingSpeedChange={noop}
        onAudioModeChange={noop}
        onOutputResolutionChange={noop}
        onAdvancedModeChange={noop}
        onAdvancedSettingsChange={noop}
        onAudioTrackSelectionChange={noop}
        onSubtitleTrackSelectionChange={noop}
        onTrimChange={noop}
        onTrimError={noop}
        onProfileSelect={noop}
        onProfileCreate={noop}
        onProfileUpdate={noop}
        onProfileRename={noop}
        onProfileDelete={noop}
        onApplyProfileToAll={noop}
        onStartEncoding={noop}
        onTogglePause={noop}
        onCancelEncoding={noop}
      />,
    );

    expect(markup).toContain("Encoding complete");
    expect(markup).not.toContain("Waiting in the queue");
  });

  it("explains when the installed engine is not the pinned release version", () => {
    const markup = renderToStaticMarkup(
      <ConvertView
        media={media}
        mediaCount={1}
        status={{
          ready: false,
          ffmpegVersion: "ffmpeg version 7.1.5 Copyright (c) 2000-2025 the FFmpeg developers",
          ffprobeVersion: "ffprobe version 7.1.5 Copyright (c) 2000-2025 the FFmpeg developers",
          error: "FFmpeg 7.1.5 does not match Vidra's required 8.1.3 engine. The development override is in use, so this is not the pinned release build.",
        }}
        qualityIndex={2}
        outputContainer="mp4"
        videoCodec="h264"
        encodingSpeed="efficient"
        audioMode="auto"
        outputResolution="source"
        isAdvancedMode={false}
        advancedSettings={DEFAULT_ADVANCED_SETTINGS}
        trackSelection={{ audioStreamIndexes: [], subtitleStreamIndexes: [] }}
        trim={null}
        copyStartSeconds={null}
        segmentError={null}
        profiles={[BUILT_IN_PROFILES[0]]}
        selectedProfileId={BUILT_IN_PROFILES[0].id}
        isProfileModified={false}
        readyItemCount={0}
        colorNoticeCount={0}
        blockedColorCount={0}
        isEncodingSupported
        isReady={false}
        isProbing={false}
        isActive={false}
        canEdit={false}
        canResume={false}
        isPaused={false}
        progress={{
          jobId: "job-1",
          percent: 0,
          indeterminate: false,
          elapsedSeconds: 0,
          outTimeSeconds: 0,
          speed: null,
          etaSeconds: null,
          frame: null,
        }}
        result={null}
        error={null}
        onSelectVideo={vi.fn()}
        onQualityChange={vi.fn()}
        onOutputContainerChange={vi.fn()}
        onVideoCodecChange={vi.fn()}
        onEncodingSpeedChange={vi.fn()}
        onAudioModeChange={vi.fn()}
        onOutputResolutionChange={vi.fn()}
        onAdvancedModeChange={vi.fn()}
        onAdvancedSettingsChange={vi.fn()}
        onAudioTrackSelectionChange={vi.fn()}
        onSubtitleTrackSelectionChange={vi.fn()}
        onTrimChange={vi.fn()}
        onTrimError={vi.fn()}
        onProfileSelect={vi.fn()}
        onProfileCreate={vi.fn()}
        onProfileUpdate={vi.fn()}
        onProfileRename={vi.fn()}
        onProfileDelete={vi.fn()}
        onApplyProfileToAll={vi.fn()}
        onStartEncoding={vi.fn()}
        onTogglePause={vi.fn()}
        onCancelEncoding={vi.fn()}
      />,
    );

    expect(markup).toContain("FFmpeg 7.1.5 does not match");
    expect(markup).toContain("required 8.1.3 engine");
    expect(markup).toContain("development override");
    expect(markup).not.toContain("FFmpeg ready");
  });
});
