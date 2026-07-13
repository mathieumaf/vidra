use super::EncodeProgress;

#[derive(Debug, Default)]
pub struct ProgressParser {
    out_time_seconds: f64,
    speed: Option<String>,
    frame: Option<u64>,
}

impl ProgressParser {
    pub fn update(
        &mut self,
        job_id: &str,
        duration_seconds: f64,
        line: &str,
    ) -> Option<EncodeProgress> {
        let (key, value) = line.trim().split_once('=')?;

        match key {
            "out_time_us" => {
                self.out_time_seconds = value.parse::<f64>().ok()? / 1_000_000.0;
            }
            "speed" => self.speed = Some(value.to_owned()),
            "frame" => self.frame = value.parse().ok(),
            "progress" => {
                let percent = if value == "end" {
                    100.0
                } else if duration_seconds > 0.0 {
                    (self.out_time_seconds / duration_seconds * 100.0).clamp(0.0, 99.9)
                } else {
                    0.0
                };

                return Some(EncodeProgress {
                    job_id: job_id.to_owned(),
                    percent,
                    out_time_seconds: self.out_time_seconds,
                    speed: self.speed.clone(),
                    frame: self.frame,
                });
            }
            _ => {}
        }

        None
    }
}

#[cfg(test)]
mod tests {
    use super::ProgressParser;

    #[test]
    fn emits_progress_after_a_progress_boundary() {
        let mut parser = ProgressParser::default();
        assert!(parser
            .update("job-1", 20.0, "out_time_us=5000000")
            .is_none());
        assert!(parser.update("job-1", 20.0, "speed=2.0x").is_none());

        let progress = parser
            .update("job-1", 20.0, "progress=continue")
            .expect("a progress payload");
        assert_eq!(progress.percent, 25.0);
        assert_eq!(progress.speed.as_deref(), Some("2.0x"));
    }

    #[test]
    fn reports_one_hundred_percent_at_the_end() {
        let mut parser = ProgressParser::default();
        let progress = parser
            .update("job-1", 20.0, "progress=end")
            .expect("a final progress payload");
        assert_eq!(progress.percent, 100.0);
    }
}
