import { describe, expect, it } from "vitest";
import { releaseTag, releaseUrl, THIRD_PARTY_NOTICE_GROUPS } from "./legal";

describe("legal product information", () => {
  it("links a version to the release tagged with that exact version", () => {
    expect(releaseTag("1.2.3")).toBe("v1.2.3");
    expect(releaseUrl("1.2.3")).toBe("https://github.com/mathieumaf/vidra/releases/tag/v1.2.3");
  });

  it("covers every bundled media component named in the notices", () => {
    const notices = THIRD_PARTY_NOTICE_GROUPS.flatMap((group) => group.notices);
    const licenses = Object.fromEntries(notices.map((notice) => [notice.name, notice.license]));

    expect(licenses).toMatchObject({
      "FFmpeg and FFprobe": "LGPL-2.1-or-later / GPL-enabled build",
      x264: "GPL-2.0-or-later",
      x265: "GPL-2.0-or-later",
      "SVT-AV1": "BSD-3-Clause",
      dav1d: "BSD-2-Clause",
      Opus: "BSD-3-Clause",
      zimg: "WTFPL v2",
    });
  });
});
