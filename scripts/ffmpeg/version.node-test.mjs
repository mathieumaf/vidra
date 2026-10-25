import assert from "node:assert/strict";
import test from "node:test";
import { comparableFfmpegVersion, ffmpegVersionMatches } from "./version.mjs";

const releaseLine = "ffmpeg version 8.1.3 Copyright (c) 2000-2026 the FFmpeg developers";

test("accepts only the pinned FFmpeg version token", () => {
  assert.equal(comparableFfmpegVersion(releaseLine), "8.1.3");
  assert.equal(
    comparableFfmpegVersion("ffprobe version 8.1.3 Copyright (c) 2007-2026 the FFmpeg developers"),
    "8.1.3",
  );
  assert.equal(comparableFfmpegVersion("ffmpeg version n8.1.3 Copyright"), "8.1.3");
  assert.equal(ffmpegVersionMatches(releaseLine, "8.1.3"), true);
  assert.equal(ffmpegVersionMatches("ffmpeg version n8.1.3\nconfiguration: test\n", "8.1.3"), true);
});

test("rejects a different upstream version, a shorter prefix, and a packager suffix", () => {
  const reports = [
    "ffmpeg version 8.1 Copyright (c) 2000-2026 the FFmpeg developers",
    "ffmpeg version 8.1.2 Copyright (c) 2000-2026 the FFmpeg developers",
    "ffmpeg version 8.1.30 Copyright (c) 2000-2026 the FFmpeg developers",
    "ffmpeg version 7.1.5 Copyright (c) 2000-2025 the FFmpeg developers",
    "ffmpeg version n7.1.5 Copyright (c) 2000-2025 the FFmpeg developers",
    "ffmpeg version 6.1.1-3ubuntu5 Copyright (c) 2000-2023 the FFmpeg developers",
    "ffmpeg version 8.1.3-0ubuntu1 Copyright (c) 2000-2026 the FFmpeg developers",
    "ffmpeg version n8.1.3-17-gabcdef Copyright",
    "not a version report",
  ];

  for (const report of reports) {
    assert.equal(ffmpegVersionMatches(report, "8.1.3"), false, report);
  }
});
