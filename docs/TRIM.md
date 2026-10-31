# Segment trimming

A conversion can use the whole source or a start and end time. The source file is only read. Vidra still encodes into a temporary file and publishes it after success, and cancellation still removes that unfinished file.

The interface shows the bounds as times and on a slider. It does not ask the user to choose between a precise cut and a fast cut.

## Re-encoded video

H.264, H.265, and AV1 use FFmpeg's default accurate seek. Vidra places `-ss` before the input, so FFmpeg seeks to the previous keyframe and then drops decoded frames until the requested start. `-t` limits the written duration to the selected length. The picture therefore starts and ends on the requested frames, without decoding the whole file from the beginning.

Compatible audio is still copied when the existing audio rules say to copy it. Copied packets from before the start would otherwise begin earlier than the re-encoded picture, because accurate seek only discards frames on streams that are decoded. Vidra sets `-copypriorss:a 0` and `-copypriorss:s 0` so copied audio and subtitle packets before the start are dropped. The first kept audio packet is the first one at or after the start, which is within one audio packet of the picture. Subtitles that are converted rather than copied, such as text written into MP4, are decoded and follow the same accurate start.

## Original video

Original video copies the encoded picture, including HDR metadata, and remains the path required for Dolby Vision sources that cannot be re-encoded. A copied video stream cannot begin between keyframes and still be decodable.

For that case Vidra disables accurate seek and reads from the previous keyframe through the requested end (`-ss` and `-to` before the input). The output includes the selected segment and can start slightly earlier, by at most the distance to that keyframe. Re-encoded audio uses the same start, so it stays aligned with the copied picture instead of being trimmed more tightly than the video. The interface says that Original video may start a little earlier and still ends at the selected time.

## Progress, space, and history

Progress and the estimated time remaining use the selected length, not the full source duration. The destination space estimate is scaled by that same fraction. History stores the start and end and shows the segment length. A selection that covers the whole video is stored as no trim.

An invalid range is rejected before FFmpeg starts: a negative time, a start that is not earlier than the end, a time past the video's duration, or a segment on a video whose duration is unknown. Times within half a millisecond of the real duration are accepted.

Chapter markers are still copied when that option is on. Their timestamps stay on the source timeline, so a marker can fall outside the segment.

Waiting queue entries keep the segment and restore it after a restart. If the source duration no longer contains those times, Vidra restores the video without the segment and says so.
