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
  },
  audio: [],
  subtitles: [],
  chapterCount: 0,
  hasMetadata: false,
};

describe("ConvertView", () => {
  it("shows a completed job as complete instead of queued", () => {
    const noop = vi.fn();
    const markup = renderToStaticMarkup(
      <ConvertView
        media={media}
        mediaCount={1}
        status={{ ready: true, ffmpegVersion: "8.1", ffprobeVersion: "8.1", error: null }}
        qualityIndex={2}
        outputContainer="mp4"
        videoCodec="h264"
        encodingSpeed="efficient"
        audioMode="auto"
        outputResolution="source"
        isAdvancedMode={false}
        advancedSettings={DEFAULT_ADVANCED_SETTINGS}
        trackSelection={{ audioStreamIndexes: [], subtitleStreamIndexes: [] }}
        profiles={[BUILT_IN_PROFILES[0]]}
        selectedProfileId={BUILT_IN_PROFILES[0].id}
        isProfileModified={false}
        readyItemCount={0}
        colorRiskCount={0}
        isReady
        isProbing={false}
        isActive={false}
        canEdit={false}
        canResume={false}
        isPaused={false}
        progress={{ jobId: "job-1", percent: 100, outTimeSeconds: 2, speed: null, etaSeconds: 0, frame: null }}
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
});
