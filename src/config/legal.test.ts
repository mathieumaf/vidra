import { describe, expect, it } from "vitest";
import { releaseTag, releaseUrl, THIRD_PARTY_NOTICE_GROUPS } from "./legal";

describe("legal product information", () => {
  it("links a built version to its exact injected release tag", () => {
    expect(releaseUrl("1.2.3", "v1.2.3-beta.1")).toBe(
      "https://github.com/mathieumaf/vidra/releases/tag/v1.2.3-beta.1",
    );
  });

  it("falls back to the version tag when release metadata is absent or invalid", () => {
    expect(releaseTag("1.2.3", null)).toBe("v1.2.3");
    expect(releaseTag("1.2.3", "v9.0.0")).toBe("v1.2.3");
    expect(releaseTag("1.2.3", "v1.2.3/unsafe")).toBe("v1.2.3");
  });

  it("covers every bundled media component named in the notices", () => {
    const notices = THIRD_PARTY_NOTICE_GROUPS.flatMap((group) => group.notices);
    const licenses = Object.fromEntries(notices.map((notice) => [notice.name, notice.license]));

    expect(licenses).toMatchObject({
      "FFmpeg and FFprobe": "LGPL-2.1-or-later / GPL-enabled build",
      x264: "GPL-2.0-or-later",
      x265: "GPL-2.0-or-later",
      "SVT-AV1": "BSD-3-Clause",
      Opus: "BSD-3-Clause",
      zimg: "WTFPL v2",
    });
  });
});
