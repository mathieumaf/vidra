use super::FfmpegStatus;

const SOURCES_JSON: &str = include_str!("../../../scripts/ffmpeg/sources.json");

pub(super) fn expected_ffmpeg_version() -> Result<String, String> {
    pinned_version("/targets/aarch64-apple-darwin/release/sources/ffmpeg/version")
}

pub(super) fn assess_engine(
    ffmpeg_version: &str,
    ffprobe_version: &str,
    development_override: bool,
) -> FfmpegStatus {
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
            development_override,
        )),
    }
}

pub(super) fn version_matches(version_output: &str, expected: &str) -> bool {
    comparable_version(version_output) == Some(expected)
}

pub(super) fn development_override_marker_name(target: &str) -> String {
    format!(".ffmpeg-development-override-{target}")
}

pub(super) fn host_target_triple() -> &'static str {
    target_triple(std::env::consts::OS, std::env::consts::ARCH).unwrap_or("unknown")
}

fn pinned_version(pointer: &str) -> Result<String, String> {
    let manifest: serde_json::Value = serde_json::from_str(SOURCES_JSON)
        .map_err(|_| String::from("Unable to read the pinned FFmpeg version."))?;
    manifest
        .pointer(pointer)
        .and_then(serde_json::Value::as_str)
        .map(str::to_owned)
        .ok_or_else(|| {
            String::from("The pinned FFmpeg version is missing from the release recipe.")
        })
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

fn engine_mismatch_message(
    ffmpeg_version: &str,
    ffprobe_version: &str,
    expected: &str,
    development_override: bool,
) -> String {
    let ffmpeg = comparable_version(ffmpeg_version).unwrap_or("unknown");
    let ffprobe = comparable_version(ffprobe_version).unwrap_or("unknown");
    let (found, verb) = if ffmpeg == ffprobe {
        (format!("FFmpeg {ffmpeg}"), "does")
    } else {
        (format!("FFmpeg {ffmpeg} and FFprobe {ffprobe}"), "do")
    };
    let requirement = format!("{found} {verb} not match Vidra's required {expected} engine.");
    if development_override {
        format!(
            "{requirement} The development override is in use, so this is not the pinned release build."
        )
    } else {
        format!("{requirement} Run pnpm ffmpeg:prepare and restart Vidra.")
    }
}

/// Rust `consts` names differ from Node's. The triple strings must match
/// `scripts/ffmpeg/target.mjs`.
fn target_triple(os: &str, arch: &str) -> Option<&'static str> {
    match (os, arch) {
        ("macos", "aarch64") => Some("aarch64-apple-darwin"),
        ("macos", "x86_64") => Some("x86_64-apple-darwin"),
        ("linux", "x86_64") => Some("x86_64-unknown-linux-gnu"),
        ("linux", "aarch64") => Some("aarch64-unknown-linux-gnu"),
        ("windows", "x86_64") => Some("x86_64-pc-windows-msvc"),
        ("windows", "aarch64") => Some("aarch64-pc-windows-msvc"),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::{
        assess_engine, comparable_version, development_override_marker_name,
        expected_ffmpeg_version, target_triple, version_matches,
    };

    const FFMPEG_812: &str = "ffmpeg version 8.1.2 Copyright (c) 2000-2026 the FFmpeg developers";
    const FFPROBE_812: &str = "ffprobe version 8.1.2 Copyright (c) 2007-2026 the FFmpeg developers";
    const FFMPEG_715: &str = "ffmpeg version 7.1.5 Copyright (c) 2000-2025 the FFmpeg developers";
    const FFPROBE_715: &str = "ffprobe version 7.1.5 Copyright (c) 2000-2025 the FFmpeg developers";

    #[test]
    fn pins_the_release_ffmpeg_version_used_by_development() {
        let manifest: serde_json::Value =
            serde_json::from_str(super::SOURCES_JSON).expect("sources.json");
        let development = manifest
            .pointer("/targets/aarch64-apple-darwin/development/version")
            .and_then(serde_json::Value::as_str);
        let expected = expected_ffmpeg_version().expect("pinned version");

        assert_eq!(expected, "8.1.2");
        assert_eq!(development, Some(expected.as_str()));
    }

    #[test]
    fn accepts_the_pinned_version_and_rejects_other_reports() {
        assert_eq!(comparable_version(FFMPEG_812), Some("8.1.2"));
        assert_eq!(
            comparable_version("ffmpeg version n8.1.2 Copyright"),
            Some("8.1.2")
        );
        assert!(version_matches(FFMPEG_812, "8.1.2"));
        assert!(version_matches(FFPROBE_812, "8.1.2"));
        assert!(!version_matches(
            "ffmpeg version 8.1 Copyright (c) 2000-2026 the FFmpeg developers",
            "8.1.2"
        ));
        assert!(!version_matches(FFMPEG_715, "8.1.2"));
        assert!(!version_matches(
            "ffmpeg version n7.1.5 Copyright (c) 2000-2025 the FFmpeg developers",
            "8.1.2"
        ));
        assert!(!version_matches(
            "ffmpeg version 6.1.1-3ubuntu5 Copyright (c) 2000-2023 the FFmpeg developers",
            "8.1.2"
        ));
        assert!(!version_matches(
            "ffmpeg version 8.1.2-0ubuntu1 Copyright (c) 2000-2026 the FFmpeg developers",
            "8.1.2"
        ));
        assert!(!version_matches("ffmpeg version 8.1.20 Copyright", "8.1.2"));
        assert_eq!(comparable_version("not a version"), None);
    }

    #[test]
    fn reports_a_system_ffmpeg_as_not_ready() {
        let overridden = assess_engine(FFMPEG_715, FFPROBE_715, true);
        assert!(!overridden.ready);
        assert_eq!(
            overridden.error.as_deref(),
            Some(
                "FFmpeg 7.1.5 does not match Vidra's required 8.1.2 engine. The development override is in use, so this is not the pinned release build."
            )
        );
        assert_eq!(overridden.ffmpeg_version.as_deref(), Some(FFMPEG_715));

        let installed = assess_engine(FFMPEG_715, FFPROBE_715, false);
        assert!(!installed.ready);
        assert_eq!(
            installed.error.as_deref(),
            Some(
                "FFmpeg 7.1.5 does not match Vidra's required 8.1.2 engine. Run pnpm ffmpeg:prepare and restart Vidra."
            )
        );
    }

    #[test]
    fn rejects_the_shorter_8_1_development_version() {
        let status = assess_engine(
            "ffmpeg version 8.1 Copyright (c) 2000-2026 the FFmpeg developers",
            "ffprobe version 8.1 Copyright (c) 2000-2026 the FFmpeg developers",
            false,
        );
        assert!(!status.ready);
        assert_eq!(
            status.error.as_deref(),
            Some(
                "FFmpeg 8.1 does not match Vidra's required 8.1.2 engine. Run pnpm ffmpeg:prepare and restart Vidra."
            )
        );
    }

    #[test]
    fn names_ffmpeg_and_ffprobe_when_their_versions_differ() {
        let status = assess_engine(FFMPEG_812, "ffprobe version 8.1 Copyright", false);
        assert!(!status.ready);
        assert_eq!(
            status.error.as_deref(),
            Some(
                "FFmpeg 8.1.2 and FFprobe 8.1 do not match Vidra's required 8.1.2 engine. Run pnpm ffmpeg:prepare and restart Vidra."
            )
        );
    }

    #[test]
    fn marks_the_pinned_release_version_ready() {
        let status = assess_engine(FFMPEG_812, FFPROBE_812, false);
        assert!(status.ready);
        assert_eq!(status.error, None);
        assert_eq!(status.ffmpeg_version.as_deref(), Some(FFMPEG_812));
        assert_eq!(status.ffprobe_version.as_deref(), Some(FFPROBE_812));
    }

    #[test]
    fn maps_host_names_onto_the_sidecar_target_triple() {
        assert_eq!(
            target_triple("macos", "aarch64"),
            Some("aarch64-apple-darwin")
        );
        assert_eq!(
            target_triple("linux", "x86_64"),
            Some("x86_64-unknown-linux-gnu")
        );
        assert_eq!(
            development_override_marker_name("x86_64-unknown-linux-gnu"),
            ".ffmpeg-development-override-x86_64-unknown-linux-gnu"
        );
        assert_eq!(target_triple("linux", "ppc64"), None);
    }
}
