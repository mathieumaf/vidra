# Formats and codecs

What Vidra reads, what it writes, and what happens to each kind of stream. The HDR rules are summarised here and stated in full in [HDR_POLICY.md](HDR_POLICY.md). Trimming is in [TRIM.md](TRIM.md).

## Input

Vidra opens MP4, MOV, MKV, WebM, AVI, M4V, MTS, and M2TS files. AV1 input is decoded in software with dav1d.

## Video

| Video | Efficient | Fast | MP4 | MKV |
| --- | --- | --- | --- | --- |
| Original | Stream copy | Stream copy | H.264, HEVC, AV1, and MPEG-4 sources. HEVC is tagged `hvc1` and AV1 is tagged `av01`. Other codecs switch the container to MKV. | Copies the video stream, including HDR metadata. |
| H.264 | x264, 8-bit 4:2:0 | VideoToolbox, 8-bit 4:2:0 | Yes. HDR sources are tone-mapped to SDR. | Yes. Same tone map. |
| H.265 | x265 | VideoToolbox | Yes, tagged `hvc1`. HDR and sources deeper than 8-bit stay 10-bit 4:2:0. | Yes. Same 10-bit rule. |
| AV1 | SVT-AV1 | Unavailable | Yes, tagged `av01`. Same 10-bit rule as H.265. | Yes. |

Fast encoding uses Apple VideoToolbox. Efficient encoding, and every AV1 encode, uses the bundled software encoders.

Deeper than 10-bit sources are capped at 10 bits for H.265 and AV1. Chroma is 4:2:0. MP4 output sets the fast-start flag, which places the playback information at the beginning of the file.

Five quality levels are available: Maximum compression, Smaller file, Balanced, High quality, and Near source. Advanced mode can nudge quality slightly smaller or more detailed.

The resolution can stay at the source's or be limited from 360p through 4K. Vidra does not upscale. A portrait frame uses those limits swapped, so a vertical video stays vertical. Rotation metadata is included in the size Vidra shows and limits. Advanced mode can lower the frame rate to 24, 25, 30, 50, or 60 fps when that is slower than the source. It does not raise it.

## Audio

| Audio | MP4 | MKV |
| --- | --- | --- |
| Automatic | Copies AAC tracks. Other tracks are encoded as AAC. | Copies every audio track. |
| Original | Copies the tracks when every one is AAC. Otherwise Vidra switches the container to MKV. | Copies every audio track. |
| AAC | Copies an AAC track when its bitrate and channel layout stay as they are. Otherwise encodes AAC. | Same. |
| Opus | Switches the container to MKV. | Copies an Opus track when its bitrate and channel layout stay as they are. Otherwise encodes with libopus. |
| None | No audio. | No audio. |

When the source bitrate is known, the encoded bitrate stays at or below it. When the source's channel count is known, channels are only reduced, never added.

## Subtitles, chapters, and metadata

| Kind | Behavior |
| --- | --- |
| MP4 subtitles | Text tracks (SubRip, ASS, SSA, MOV text, WebVTT) are converted to MOV text. ASS and SSA styling is dropped. Image-based tracks, including PGS and DVD subtitles, are left out. |
| MKV subtitles | Tracks are copied, including image-based tracks. MOV text is converted to SubRip, because Matroska cannot store MOV text. A trim also rewrites text tracks: see [TRIM.md](TRIM.md). |
| Chapters and metadata | Kept for MP4 and MKV when those options are on, which is the default. |

You choose which audio and subtitle tracks to keep.

## HDR

The conversion screen states the HDR choice before encoding.

- **Original video** copies the encoded video stream and its HDR metadata.
- **H.264** converts PQ or HLG to limited-range BT.709 SDR with a Mobius tone map, and removes mastering-display, content-light, and HDR10+ metadata from that SDR output. If the transfer characteristic cannot be established, Vidra stops and asks for Original video.
- **H.265 and AV1** keep HDR as 10-bit video and carry the source transfer, primaries, matrix, and range. When those tags are missing but can be inferred, Vidra uses BT.2020 with the detected PQ or HLG transfer. Static mastering-display and content-light metadata are passed through when the encoder supports them.
- Dynamic HDR10+ metadata is not guaranteed to survive a re-encode. Original video is the choice when that metadata has to stay intact.
- Dolby Vision can always be copied. Re-encoding is allowed only when the file has a single backward-compatible HDR base layer and no enhancement layer. That re-encode keeps the compatible HLG or HDR10 base and does not recreate Dolby Vision metadata. Profile 5, enhancement-layer, and unclassified Dolby Vision sources require Original video.

The full rules are in [HDR_POLICY.md](HDR_POLICY.md).
