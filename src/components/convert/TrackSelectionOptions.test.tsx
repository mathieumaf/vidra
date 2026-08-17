import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { SubtitleStream } from "../../types/media";
import { TrackSelectionOptions } from "./TrackSelectionOptions";

const subtitles: SubtitleStream[] = [
  {
    index: 2,
    codec: "subrip",
    language: "eng",
    title: null,
    isDefault: true,
    isForced: false,
  },
  {
    index: 3,
    codec: "ass",
    language: "fra",
    title: null,
    isDefault: false,
    isForced: false,
  },
  {
    index: 4,
    codec: "hdmv_pgs_subtitle",
    language: "eng",
    title: "Signs",
    isDefault: false,
    isForced: true,
  },
  {
    index: 5,
    codec: "dvd_subtitle",
    language: null,
    title: null,
    isDefault: false,
    isForced: false,
  },
  {
    index: 6,
    codec: "webvtt",
    language: "deu",
    title: null,
    isDefault: false,
    isForced: false,
  },
];

describe("TrackSelectionOptions subtitles", () => {
  it("explains MP4 text conversion and excludes image-based tracks", () => {
    const markup = render("mp4");

    expect(markup).toContain("Text subtitle tracks will be converted to MP4 text.");
    expect(markup).toContain("ASS styling will be lost.");
    expect(markup).toContain("2 image-based subtitle tracks cannot be kept in MP4.");
    expect(markup).toContain("SUBRIP · Converted to MP4 text");
    expect(markup).toContain("ASS · Converted to MP4 text; styling will be lost");
    expect(markup).toContain("WEBVTT · Converted to MP4 text");
    expect(markup).toContain("HDMV_PGS_SUBTITLE · Image-based; cannot be kept in MP4");
    expect(markup).toContain("DVD_SUBTITLE · Image-based; cannot be kept in MP4");
    expect(markup).toContain('aria-label="Subtitle 3 · Signs cannot be kept in MP4"');
    expect(markup).toContain('aria-label="Subtitle 4 cannot be kept in MP4"');
    expect(markup).toMatch(
      /<input[^>]*disabled=""[^>]*aria-label="Subtitle 3 · Signs cannot be kept in MP4"/,
    );
    expect(markup).toMatch(
      /<input[^>]*disabled=""[^>]*aria-label="Subtitle 4 cannot be kept in MP4"/,
    );
  });

  it("keeps every selected subtitle track available for MKV copying", () => {
    const markup = render("mkv");

    expect(markup).not.toContain("cannot be kept");
    expect(markup).not.toContain("Converted to MP4 text");
    expect(markup.match(/checked=""/g)).toHaveLength(5);
  });
});

function render(container: "mp4" | "mkv"): string {
  return renderToStaticMarkup(
    <TrackSelectionOptions
      audio={[]}
      subtitles={subtitles}
      container={container}
      audioMode="auto"
      selection={{
        audioStreamIndexes: [],
        subtitleStreamIndexes: subtitles.map((track) => track.index),
      }}
      disabled={false}
      onAudioChange={vi.fn()}
      onSubtitleChange={vi.fn()}
    />,
  );
}
