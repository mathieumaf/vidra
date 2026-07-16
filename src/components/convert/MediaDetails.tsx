import { formatBitrate, formatBytes, formatDuration } from "../../lib/format";
import {
  bitDepthLabel,
  colorPrimariesLabel,
  colorRangeLabel,
  colorSpaceLabel,
  colorTransferLabel,
  hdrFormatLabel,
} from "../../lib/color";
import {
  audioTrackName,
  channelLabel,
  codecLabel,
  languageLabel,
  sampleRateLabel,
  subtitleTrackName,
} from "../../lib/tracks";
import type { AudioStream, MediaInfo, SubtitleStream } from "../../types/media";

export function MediaDetails({ media }: { media: MediaInfo }) {
  return (
    <section className="media-details-card">
      <div className="media-details-heading">
        <div>
          <span className="section-label">MEDIA DETAILS</span>
          <strong>What Vidra found in this source</strong>
          <p>Read-only technical information reported by FFprobe.</p>
        </div>
      </div>

      <div className="media-details-overview">
        <OverviewItem label="Container" value={containerLabel(media)} />
        <OverviewItem label="Duration" value={formatDuration(media.durationSeconds)} />
        <OverviewItem label="File size" value={formatBytes(media.sizeBytes)} />
        <OverviewItem label="Streams" value={streamSummary(media)} />
      </div>

      <div className="media-stream-groups">
        <div className="media-stream-group">
          <GroupHeading label="Video" count={media.video ? 1 : 0} />
          {media.video ? (
            <div className="media-stream-row">
              <div className="media-stream-title">
                <strong>Video track</strong>
                {media.video.hdrFormat && <span className="hdr-badge">{hdrFormatLabel(media.video.hdrFormat)}</span>}
                {media.video.bitDepth && <span>{bitDepthLabel(media.video.bitDepth)}</span>}
              </div>
              <div className="media-stream-facts">
                <span>{codecLabel(media.video.codec)}</span>
                <span>{media.video.width} × {media.video.height}</span>
                <span>{frameRateLabel(media.video.frameRate)}</span>
                <span>{media.video.pixelFormat?.toUpperCase() ?? "Unknown pixel format"}</span>
              </div>
              <div className="media-color-facts">
                <ColorFact
                  label="Primaries"
                  value={media.video.colorPrimaries
                    ? colorPrimariesLabel(media.video.colorPrimaries)
                    : "Unknown"}
                />
                <ColorFact
                  label="Transfer"
                  value={media.video.colorTransfer
                    ? colorTransferLabel(media.video.colorTransfer)
                    : "Unknown"}
                />
                <ColorFact
                  label="Matrix"
                  value={media.video.colorSpace
                    ? colorSpaceLabel(media.video.colorSpace)
                    : "Unknown"}
                />
                <ColorFact
                  label="Range"
                  value={media.video.colorRange
                    ? colorRangeLabel(media.video.colorRange)
                    : "Unknown"}
                />
              </div>
            </div>
          ) : (
            <EmptyTrack copy="No video track found." />
          )}
        </div>

        <div className="media-stream-group">
          <GroupHeading label="Audio" count={media.audio.length} />
          {media.audio.length > 0 ? media.audio.map((track, index) => (
            <AudioTrack key={`${track.codec}-${index}`} track={track} index={index} />
          )) : (
            <EmptyTrack copy="No audio tracks found." />
          )}
        </div>

        <div className="media-stream-group subtitle-stream-group">
          <GroupHeading label="Subtitles" count={media.subtitles.length} />
          {media.subtitles.length > 0 ? media.subtitles.map((track, index) => (
            <SubtitleTrack key={`${track.codec}-${index}`} track={track} index={index} />
          )) : (
            <EmptyTrack copy="No subtitle tracks found." />
          )}
        </div>
      </div>

      <div className="media-source-flags">
        <span><strong>Chapters</strong>{media.chapterCount > 0 ? countLabel(media.chapterCount, "chapter") : "None found"}</span>
        <span><strong>Metadata</strong>{media.hasMetadata ? "Available" : "None found"}</span>
      </div>
    </section>
  );
}

function ColorFact({ label, value }: { label: string; value: string }) {
  return <span title={`${label}: ${value}`}><strong>{label}</strong>{value}</span>;
}

function OverviewItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="media-overview-item">
      <span>{label}</span>
      <strong title={value}>{value}</strong>
    </div>
  );
}

function GroupHeading({ label, count }: { label: string; count: number }) {
  return (
    <div className="media-stream-heading">
      <strong>{label}</strong>
      <span>{count}</span>
    </div>
  );
}

function AudioTrack({ track, index }: { track: AudioStream; index: number }) {
  const language = languageLabel(track.language);
  return (
    <div className="media-stream-row">
      <div className="media-stream-title">
        <strong>{audioTrackName(track, index)}</strong>
        {language && <span>{language}</span>}
      </div>
      <div className="media-stream-facts">
        <span>{codecLabel(track.codec)}</span>
        <span>{channelLabel(track.channels)}</span>
        <span>{bitrateLabel(track.bitRate)}</span>
        <span>{sampleRateLabel(track.sampleRate)}</span>
      </div>
    </div>
  );
}

function SubtitleTrack({ track, index }: { track: SubtitleStream; index: number }) {
  const language = languageLabel(track.language);
  return (
    <div className="media-stream-row compact-stream-row">
      <div className="media-stream-title">
        <strong>{subtitleTrackName(track, index)}</strong>
        {language && <span>{language}</span>}
        {track.isDefault && <span>Default</span>}
        {track.isForced && <span>Forced</span>}
      </div>
      <div className="media-stream-facts"><span>{codecLabel(track.codec)}</span></div>
    </div>
  );
}

function EmptyTrack({ copy }: { copy: string }) {
  return <p className="empty-track-copy">{copy}</p>;
}

function containerLabel(media: MediaInfo): string {
  if (media.formatLongName) return media.formatLongName;
  return media.formatName
    .split(",")
    .map((name) => name.trim().toUpperCase())
    .filter(Boolean)
    .join(" / ") || "Unknown container";
}

function streamSummary(media: MediaInfo): string {
  const values = [
    countLabel(media.video ? 1 : 0, "video"),
    countLabel(media.audio.length, "audio"),
  ];
  if (media.subtitles.length > 0) values.push(countLabel(media.subtitles.length, "subtitle"));
  return values.join(" · ");
}

function frameRateLabel(frameRate: number | null): string {
  if (frameRate === null || !Number.isFinite(frameRate)) return "Unknown frame rate";
  return `${Number(frameRate.toFixed(2))} fps`;
}

function bitrateLabel(bitRate: number | null): string {
  return bitRate ? formatBitrate(bitRate) : "Unknown bitrate";
}

function countLabel(count: number, singular: string): string {
  return `${count} ${singular}${count === 1 ? "" : "s"}`;
}
