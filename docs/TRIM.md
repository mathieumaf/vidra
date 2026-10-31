# Segment trimming

A conversion can use the whole source or a start and end time. The source file is only read. Vidra still encodes into a temporary file and publishes it after success, and cancellation still removes that unfinished file.

The interface shows the bounds as times and on a slider. It does not ask the user to choose between a precise cut and a fast cut.

## Re-encoded video

H.264, H.265, and AV1 use FFmpeg's default accurate seek. Vidra places `-ss` before the input, so FFmpeg seeks to the previous keyframe and then drops decoded frames until the requested start. `-t` limits the written duration to the selected length. The picture therefore starts and ends on the requested frames.

Compatible audio is still copied when the existing audio rules say to copy it. Vidra drops copied audio packets from before the start so they do not lead the picture. The first kept audio packet is the first one at or after the start.

Text subtitles are rewritten onto that same timeline. A cue already on screen at the start is kept and shortened so it begins with the clip. A cue that would run past the end is shortened so the container duration stays with the video. Vidra reads subtitle cues from five minutes before the clip through the end, so it does not have to scan the whole file. A cue that started earlier than that window is not included. Styled ASS and SSA cues are saved as plain SubRip when a segment is selected, because that is what makes the clip reliable. Image subtitles stay copied and are not rewritten.

## Original video

Original video copies the encoded picture, including HDR metadata, and remains the path required for Dolby Vision sources that cannot be re-encoded. A copied picture cannot begin between keyframes.

Vidra finds the keyframe at or before the chosen start and reads from there through the chosen end. It looks in a short window before the start, then a wider window only when that range has no saved picture, so a late start does not scan the whole file. The file is therefore longer than the times typed in the fields: it starts at that keyframe, which can be a full keyframe interval earlier (several seconds, and 10 seconds or more on some camera files), and it still ends at the chosen time. The segment card, the queue, progress, the estimated time remaining, and history use that real length. The card states the earlier start. While Vidra is still finding that picture, the length says "Checking…" and encoding stays disabled. If the picture cannot be found, the length says "Unavailable", the card explains that the conversion was not started, and encoding stays disabled until the start time changes or another video format is chosen. Vidra does not start the encode while the displayed length would be the typed length instead of the real one.

Chapters are moved onto that same timeline and clipped to the file. A chapter that would start before the keyframe or end after the chosen time is shortened or dropped. Text subtitles are clipped the same way and added after the picture and audio timestamps have been normalized, so a cue is not shifted by the gap between the typed start and the keyframe. That second step writes a temporary file that keeps the output container's extension, so the subtitles can be stored in MKV or MP4.

## Progress, space, and history

Progress and the estimated time remaining use the output length: the typed length for a re-encode, and the keyframe-to-end length for Original video. History stores those same bounds. A selection that covers the whole video is stored as no trim.

An invalid range is rejected before FFmpeg starts: a negative time, a start that is not earlier than the end, a time past the video's duration, or a segment on a video whose duration is unknown. Times within half a millisecond of the real duration are accepted. Leaving a time field while its text is invalid restores the last valid time, so the field shows the segment that will actually be encoded.

A failed conversion's diagnostic report quotes the FFmpeg command that ran, including chapter and subtitle files that were added for the segment. Those lines stay in the report after the temporary segment files are removed.

Waiting queue entries keep the segment and restore it after a restart. If the source duration no longer contains those times, Vidra restores the video without the segment and says so.
