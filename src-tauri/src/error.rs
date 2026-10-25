use serde::Serialize;
use std::fmt::{Display, Formatter};

pub type ApiResult<T> = Result<T, ApiError>;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiError {
    pub code: String,
    pub message: String,
}

impl ApiError {
    pub fn new(code: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            code: code.into(),
            message: message.into(),
        }
    }

    pub fn invalid_input(message: impl Into<String>) -> Self {
        Self::new("invalid_input", message)
    }

    pub fn ffmpeg(message: impl Into<String>) -> Self {
        Self::new("ffmpeg_error", message)
    }
}

impl Display for ApiError {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(&self.message)
    }
}

impl std::error::Error for ApiError {}

#[cfg(test)]
mod tests {
    use super::ApiError;

    #[test]
    fn error_codes_serialize_with_the_frontend_field_names() {
        let invalid = ApiError::invalid_input("The input path must be absolute.");
        assert_eq!(invalid.code, "invalid_input");
        assert_eq!(invalid.to_string(), "The input path must be absolute.");
        assert_eq!(
            serde_json::to_value(&invalid).unwrap(),
            serde_json::json!({
                "code": "invalid_input",
                "message": "The input path must be absolute."
            })
        );

        let ffmpeg = ApiError::ffmpeg("Unable to pause FFmpeg: no such process");
        assert_eq!(ffmpeg.code, "ffmpeg_error");
        assert_eq!(
            serde_json::to_value(&ffmpeg).unwrap(),
            serde_json::json!({
                "code": "ffmpeg_error",
                "message": "Unable to pause FFmpeg: no such process"
            })
        );

        let custom = ApiError::new("insufficient_disk_space", "Choose another destination.");
        assert_eq!(
            serde_json::to_value(&custom).unwrap(),
            serde_json::json!({
                "code": "insufficient_disk_space",
                "message": "Choose another destination."
            })
        );
    }
}
