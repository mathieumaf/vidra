use super::FfmpegStatus;

const SOURCES_JSON: &str = include_str!("../../../scripts/ffmpeg/sources.json");

pub(super) fn expected_ffmpeg_version() -> Result<String, String> {
    pinned_version("/targets/aarch64-apple-darwin/sources/ffmpeg/version")
}

pub(super) fn assess_engine(ffmpeg_version: &str, ffprobe_version: &str) -> FfmpegStatus {
    let expected = match expected_ffmpeg_version() {
        Ok(version) => version,
        Err(error) => {
            return FfmpegStatus {
                ready: false,
                ffmpeg_version: Some(ffmpeg_version.to_owned()),
                ffprobe_version: Some(ffprobe_version.to_owned()),
                error: Some(error),
            };
        }
    };

    if version_matches(ffmpeg_version, &expected) && version_matches(ffprobe_version, &expected) {
        return FfmpegStatus {
            ready: true,
            ffmpeg_version: Some(ffmpeg_version.to_owned()),
            ffprobe_version: Some(ffprobe_version.to_owned()),
            error: None,
        };
    }

    FfmpegStatus {
        ready: false,
        ffmpeg_version: Some(ffmpeg_version.to_owned()),
        ffprobe_version: Some(ffprobe_version.to_owned()),
        error: Some(engine_mismatch_message(
            ffmpeg_version,
            ffprobe_version,
            &expected,
        )),
    }
}

pub(super) fn version_matches(version_output: &str, expected: &str) -> bool {
    comparable_version(version_output) == Some(expected)
}

fn pinned_version(pointer: &str) -> Result<String, String> {
    let manifest: serde_json::Value = serde_json::from_str(SOURCES_JSON)
        .map_err(|_| String::from("Unable to read the pinned FFmpeg version."))?;
    manifest
        .pointer(pointer)
        .and_then(serde_json::Value::as_str)
        .map(str::to_owned)
        .ok_or_else(|| String::from("The pinned FFmpeg version is missing from the engine recipe."))
}

/// Version token after `version`, with one leading `n` removed when it comes
/// from FFmpeg's git describe. The remainder must equal the pin exactly.
fn comparable_version(version_output: &str) -> Option<&str> {
    let line = version_output
        .lines()
        .find(|line| !line.trim().is_empty())?;
    let mut parts = line.split_whitespace();
    let token = loop {
        match parts.next() {
            Some("version") => break parts.next()?,
            Some(_) => {}
            None => return None,
        }
    };
    match token.strip_prefix('n') {
        Some(rest) if rest.starts_with(|character: char| character.is_ascii_digit()) => Some(rest),
        _ => Some(token),
    }
}

fn engine_mismatch_message(ffmpeg_version: &str, ffprobe_version: &str, expected: &str) -> String {
    let ffmpeg = comparable_version(ffmpeg_version).unwrap_or("unknown");
    let ffprobe = comparable_version(ffprobe_version).unwrap_or("unknown");
    let (found, verb) = if ffmpeg == ffprobe {
        (format!("FFmpeg {ffmpeg}"), "does")
    } else {
        (format!("FFmpeg {ffmpeg} and FFprobe {ffprobe}"), "do")
    };
    format!(
        "{found} {verb} not match Vidra's required {expected} engine. Run pnpm ffmpeg:prepare and restart Vidra."
    )
}

#[cfg(test)]
mod tests {
    use super::{assess_engine, comparable_version, expected_ffmpeg_version, version_matches};

    const FFMPEG_813: &str = "ffmpeg version 8.1.3 Copyright (c) 2000-2026 the FFmpeg developers";
    const FFPROBE_813: &str = "ffprobe version 8.1.3 Copyright (c) 2007-2026 the FFmpeg developers";
    const FFMPEG_812: &str = "ffmpeg version 8.1.2 Copyright (c) 2000-2026 the FFmpeg developers";
    const FFPROBE_812: &str = "ffprobe version 8.1.2 Copyright (c) 2007-2026 the FFmpeg developers";
    const FFMPEG_715: &str = "ffmpeg version 7.1.5 Copyright (c) 2000-2025 the FFmpeg developers";
    const FFPROBE_715: &str = "ffprobe version 7.1.5 Copyright (c) 2000-2025 the FFmpeg developers";

    #[test]
    fn expects_the_ffmpeg_version_of_the_pinned_engine_archive() {
        let engine: serde_json::Value =
            serde_json::from_str(include_str!("../../../scripts/ffmpeg/engine.json"))
                .expect("engine.json");
        let expected = expected_ffmpeg_version().expect("pinned version");

        assert_eq!(expected, "8.1.3");
        assert_eq!(engine["version"].as_str(), Some(expected.as_str()));
    }

    #[test]
    fn accepts_the_pinned_version_and_rejects_other_reports() {
        assert_eq!(comparable_version(FFMPEG_813), Some("8.1.3"));
        assert_eq!(
            comparable_version("ffmpeg version n8.1.3 Copyright"),
            Some("8.1.3")
        );
        assert!(version_matches(FFMPEG_813, "8.1.3"));
        assert!(version_matches(FFPROBE_813, "8.1.3"));
        assert!(!version_matches(FFMPEG_812, "8.1.3"));
        assert!(!version_matches(FFPROBE_812, "8.1.3"));
        assert!(!version_matches(
            "ffmpeg version 8.1 Copyright (c) 2000-2026 the FFmpeg developers",
            "8.1.3"
        ));
        assert!(!version_matches(FFMPEG_715, "8.1.3"));
        assert!(!version_matches(
            "ffmpeg version n7.1.5 Copyright (c) 2000-2025 the FFmpeg developers",
            "8.1.3"
        ));
        assert!(!version_matches(
            "ffmpeg version 6.1.1-3ubuntu5 Copyright (c) 2000-2023 the FFmpeg developers",
            "8.1.3"
        ));
        assert!(!version_matches(
            "ffmpeg version 8.1.3-0ubuntu1 Copyright (c) 2000-2026 the FFmpeg developers",
            "8.1.3"
        ));
        assert!(!version_matches("ffmpeg version 8.1.30 Copyright", "8.1.3"));
        assert_eq!(comparable_version("not a version"), None);
    }

    #[test]
    fn reports_another_ffmpeg_as_not_ready() {
        let installed = assess_engine(FFMPEG_715, FFPROBE_715);
        assert!(!installed.ready);
        assert_eq!(installed.ffmpeg_version.as_deref(), Some(FFMPEG_715));
        assert_eq!(
            installed.error.as_deref(),
            Some(
                "FFmpeg 7.1.5 does not match Vidra's required 8.1.3 engine. Run pnpm ffmpeg:prepare and restart Vidra."
            )
        );
    }

    #[test]
    fn rejects_the_shorter_8_1_development_version() {
        let status = assess_engine(
            "ffmpeg version 8.1 Copyright (c) 2000-2026 the FFmpeg developers",
            "ffprobe version 8.1 Copyright (c) 2000-2026 the FFmpeg developers",
        );
        assert!(!status.ready);
        assert_eq!(
            status.error.as_deref(),
            Some(
                "FFmpeg 8.1 does not match Vidra's required 8.1.3 engine. Run pnpm ffmpeg:prepare and restart Vidra."
            )
        );
    }

    #[test]
    fn names_ffmpeg_and_ffprobe_when_their_versions_differ() {
        let status = assess_engine(FFMPEG_813, "ffprobe version 8.1 Copyright");
        assert!(!status.ready);
        assert_eq!(
            status.error.as_deref(),
            Some(
                "FFmpeg 8.1.3 and FFprobe 8.1 do not match Vidra's required 8.1.3 engine. Run pnpm ffmpeg:prepare and restart Vidra."
            )
        );
    }

    #[test]
    fn rejects_the_previous_8_1_2_release() {
        let status = assess_engine(FFMPEG_812, FFPROBE_812);
        assert!(!status.ready);
        assert_eq!(
            status.error.as_deref(),
            Some(
                "FFmpeg 8.1.2 does not match Vidra's required 8.1.3 engine. Run pnpm ffmpeg:prepare and restart Vidra."
            )
        );
    }

    #[test]
    fn marks_the_pinned_release_version_ready() {
        let status = assess_engine(FFMPEG_813, FFPROBE_813);
        assert!(status.ready);
        assert_eq!(status.error, None);
        assert_eq!(status.ffmpeg_version.as_deref(), Some(FFMPEG_813));
        assert_eq!(status.ffprobe_version.as_deref(), Some(FFPROBE_813));
    }
}
