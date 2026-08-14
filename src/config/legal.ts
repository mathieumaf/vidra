export const SOURCE_REPOSITORY_URL = "https://github.com/mathieumaf/vidra";

export function releaseTag(version: string, injectedTag = __VIDRA_RELEASE_TAG__): string {
  const versionTag = `v${version}`;
  return typeof injectedTag === "string"
    && injectedTag.startsWith(versionTag)
    && /^v[0-9A-Za-z.+-]+$/.test(injectedTag)
    ? injectedTag
    : versionTag;
}

export function releaseUrl(version: string, injectedTag = __VIDRA_RELEASE_TAG__): string {
  return `${SOURCE_REPOSITORY_URL}/releases/tag/${releaseTag(version, injectedTag)}`;
}

export type ThirdPartyNotice = {
  name: string;
  license: string;
  detail: string;
};

export type ThirdPartyNoticeGroup = {
  title: string;
  notices: ThirdPartyNotice[];
};

export const THIRD_PARTY_NOTICE_GROUPS: ThirdPartyNoticeGroup[] = [
  {
    title: "Bundled media engine",
    notices: [
      {
        name: "FFmpeg and FFprobe",
        license: "LGPL-2.1-or-later / GPL-enabled build",
        detail: "Local media inspection and conversion. Vidra release builds include GPL components.",
      },
      {
        name: "x264",
        license: "GPL-2.0-or-later",
        detail: "H.264 video encoding.",
      },
      {
        name: "x265",
        license: "GPL-2.0-or-later",
        detail: "H.265 video encoding.",
      },
      {
        name: "SVT-AV1",
        license: "BSD-3-Clause",
        detail: "AV1 video encoding.",
      },
      {
        name: "Opus",
        license: "BSD-3-Clause",
        detail: "Opus audio encoding.",
      },
      {
        name: "zimg",
        license: "WTFPL v2",
        detail: "Color conversion used by HDR tone mapping.",
      },
    ],
  },
  {
    title: "Application framework",
    notices: [
      {
        name: "Tauri and official plugins",
        license: "Apache-2.0 OR MIT",
        detail: "Cross-platform desktop application framework.",
      },
      {
        name: "React",
        license: "MIT",
        detail: "User interface library.",
      },
      {
        name: "Lucide",
        license: "ISC",
        detail: "Interface icons provided through lucide-react.",
      },
    ],
  },
];
