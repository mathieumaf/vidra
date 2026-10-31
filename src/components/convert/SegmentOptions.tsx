import { useEffect, useState } from "react";
import type { SegmentTrim, VideoCodec } from "../../types/media";
import {
  assessTrim,
  durationKnown,
  formatTimestamp,
  INVALID_TIME,
  parseTimestamp,
} from "../../lib/trim";

type SegmentOptionsProps = {
  durationSeconds: number;
  videoCodec: VideoCodec;
  trim: SegmentTrim | null;
  mediaCount: number;
  disabled: boolean;
  onChange: (trim: SegmentTrim | null) => void;
  onError: (message: string | null) => void;
};

type TimeField = "start" | "end";

export function SegmentOptions({
  durationSeconds,
  videoCodec,
  trim,
  mediaCount,
  disabled,
  onChange,
  onError,
}: SegmentOptionsProps) {
  const known = durationKnown(durationSeconds);
  const start = trim?.startSeconds ?? 0;
  const end = trim?.endSeconds ?? (known ? durationSeconds : 0);
  const [drafts, setDrafts] = useState<{ start: string; end: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const controlsDisabled = disabled || !known;

  useEffect(() => {
    onError(controlsDisabled ? null : error);
    return () => onError(null);
  }, [controlsDisabled, error, onError]);

  function report(next: SegmentTrim | null, message: string | null) {
    setError(message);
    if (!message) onChange(next);
  }

  function commit(nextStart: number, nextEnd: number) {
    const assessment = assessTrim(
      { startSeconds: nextStart, endSeconds: nextEnd },
      durationSeconds,
    );
    if (!assessment.ok) {
      setError(assessment.message);
      return;
    }
    report(assessment.trim, null);
  }

  function changeField(field: TimeField, value: string) {
    const nextDrafts = {
      start: drafts?.start ?? formatTimestamp(start),
      end: drafts?.end ?? formatTimestamp(end),
      [field]: value,
    };
    setDrafts(nextDrafts);
    const parsedStart = parseTimestamp(nextDrafts.start);
    const parsedEnd = parseTimestamp(nextDrafts.end);
    if (parsedStart === null || parsedEnd === null) {
      setError(INVALID_TIME);
      return;
    }
    commit(parsedStart, parsedEnd);
  }

  function changeSlider(field: TimeField, value: number) {
    const gap = sliderGap(durationSeconds);
    if (field === "start") {
      commit(Math.min(value, end - gap), end);
    } else {
      commit(start, Math.max(value, start + gap));
    }
    setDrafts(null);
  }

  const length = Math.max(0, end - start);
  const startPercent = known ? (start / durationSeconds) * 100 : 0;
  const endPercent = known ? (end / durationSeconds) * 100 : 100;

  return (
    <section className="segment-card">
      <div className="segment-heading">
        <div>
          <span className="section-label">SEGMENT</span>
          <strong>{trim ? "Convert a segment" : "Convert the whole video"}</strong>
          <p>{segmentNote(videoCodec, known)}</p>
        </div>
        <button
          type="button"
          disabled={controlsDisabled || !trim}
          onClick={() => {
            setDrafts(null);
            report(null, null);
          }}
        >
          Use the whole video
        </button>
      </div>

      <div className="segment-slider">
        <div className="segment-slider-rail" />
        <div
          className="segment-slider-selection"
          style={{ left: `${startPercent}%`, width: `${Math.max(0, endPercent - startPercent)}%` }}
        />
        <input
          type="range"
          aria-label="Segment start"
          min={0}
          max={known ? durationSeconds : 0}
          step={sliderStep(durationSeconds)}
          value={known ? start : 0}
          disabled={controlsDisabled}
          onChange={(event) => changeSlider("start", Number(event.target.value))}
        />
        <input
          type="range"
          aria-label="Segment end"
          min={0}
          max={known ? durationSeconds : 0}
          step={sliderStep(durationSeconds)}
          value={known ? end : 0}
          disabled={controlsDisabled}
          onChange={(event) => changeSlider("end", Number(event.target.value))}
        />
      </div>

      <div className="segment-times">
        <label>
          <span>Start</span>
          <input
            aria-label="Segment start time"
            inputMode="decimal"
            value={drafts?.start ?? formatTimestamp(start)}
            disabled={controlsDisabled}
            aria-invalid={error !== null}
            onFocus={() => setDrafts({
              start: formatTimestamp(start),
              end: formatTimestamp(end),
            })}
            onChange={(event) => changeField("start", event.target.value)}
            onBlur={() => {
              setDrafts(null);
              setError(null);
            }}
          />
        </label>
        <label>
          <span>End</span>
          <input
            aria-label="Segment end time"
            inputMode="decimal"
            value={drafts?.end ?? formatTimestamp(end)}
            disabled={controlsDisabled}
            aria-invalid={error !== null}
            onFocus={() => setDrafts({
              start: formatTimestamp(start),
              end: formatTimestamp(end),
            })}
            onChange={(event) => changeField("end", event.target.value)}
            onBlur={() => {
              setDrafts(null);
              setError(null);
            }}
          />
        </label>
        <div className="segment-length">
          <span>Length</span>
          <strong>{known ? formatTimestamp(length) : "Unknown"}</strong>
        </div>
      </div>

      {error && <p className="segment-error" role="alert">{error}</p>}
      {mediaCount > 1 && (
        <p className="segment-scope">This segment applies only to the video shown above.</p>
      )}
    </section>
  );
}

function segmentNote(videoCodec: VideoCodec, known: boolean): string {
  if (!known) {
    return "This video's duration is unknown, so Vidra converts the whole file.";
  }
  if (videoCodec === "copy") {
    return "Original video is copied unchanged, so the clip may start a little earlier than the time you choose. It still ends at that time.";
  }
  return "The converted picture starts and ends on these times. Audio and subtitles follow the same segment.";
}

function sliderStep(durationSeconds: number): number {
  if (!durationKnown(durationSeconds) || durationSeconds <= 60) return 0.01;
  if (durationSeconds <= 600) return 0.1;
  return 1;
}

function sliderGap(durationSeconds: number): number {
  return Math.max(sliderStep(durationSeconds), 0.001);
}
