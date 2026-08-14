# HDR conversion policy

Vidra chooses HDR behavior from the selected video codec. The interface describes the chosen behavior before encoding.

## Codec behavior

- **Original video** copies the encoded video stream unchanged, including its HDR metadata.
- **H.264** converts HDR sources to SDR. Vidra linearizes PQ or HLG input, applies a Mobius tone map, converts the result to limited-range BT.709, and writes matching BT.709 color tags.
- **H.265 and AV1** preserve HDR sources as 10-bit video. Vidra carries the source transfer characteristics, color primaries, matrix, and range into the output. When an HDR source omits otherwise inferable tags, Vidra uses BT.2020 with the detected PQ or HLG transfer.

Static mastering-display and content-light metadata are passed through when the selected FFmpeg encoder supports them. Dynamic HDR10+ metadata is not guaranteed to survive a re-encode; the interface recommends Original video when exact dynamic metadata matters.

## Dolby Vision

Vidra always permits Original video for Dolby Vision sources. Re-encoding is permitted only when FFprobe reports a single backward-compatible HDR base layer and no enhancement layer. In that case:

- H.264 converts the compatible base layer to SDR;
- H.265 and AV1 preserve the compatible HLG or HDR10 base layer, but do not claim to recreate Dolby Vision metadata.

Profile 5, enhancement-layer, and unclassified Dolby Vision sources are blocked from re-encoding because decoding only their base video can produce incorrect brightness or color. The user must select Original video.

## Unknown HDR input

H.264 tone mapping requires a known PQ or HLG transfer characteristic. If the transfer cannot be established, Vidra stops before encoding and asks the user to select Original video. This is safer than silently producing an incorrectly mapped SDR file.
