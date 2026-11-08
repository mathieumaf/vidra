use super::EncodeProgress;
use std::time::Instant;

#[derive(Debug)]
pub struct ProgressParser {
    started_at: Instant,
    out_time_seconds: f64,
    speed: Option<String>,
    frame: Option<u64>,
    last_sample: Option<(Instant, f64)>,
    recent_speed: Option<f64>,
}

impl Default for ProgressParser {
    fn default() -> Self {
        Self {
            started_at: Instant::now(),
            out_time_seconds: 0.0,
            speed: None,
            frame: None,
            last_sample: None,
            recent_speed: None,
        }
    }
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
                // FFmpeg averages speed over wall time, including SIGSTOP pauses.
                // Use the most recent progress interval so a pause does not distort
                // the estimate for the rest of the conversion.
                let now = Instant::now();
                if let Some((previous_time, previous_output)) = self.last_sample {
                    let elapsed = now.duration_since(previous_time).as_secs_f64();
                    let advanced = self.out_time_seconds - previous_output;
                    self.recent_speed =
                        (elapsed > 0.0 && advanced > 0.0).then_some(advanced / elapsed);
                }
                self.last_sample = Some((now, self.out_time_seconds));
                let duration_known = duration_seconds.is_finite() && duration_seconds > 0.0;
                let percent = if value == "end" {
                    100.0
                } else if duration_known {
                    (self.out_time_seconds / duration_seconds * 100.0).clamp(0.0, 99.9)
                } else {
                    0.0
                };
                let indeterminate = value != "end" && !duration_known;
                let eta_seconds = if !duration_known {
                    None
                } else if value == "end" {
                    Some(0.0)
                } else {
                    self.estimated_seconds_remaining(duration_seconds)
                };

                return Some(EncodeProgress {
                    job_id: job_id.to_owned(),
                    percent,
                    indeterminate,
                    elapsed_seconds: self.started_at.elapsed().as_secs_f64(),
                    out_time_seconds: self.out_time_seconds,
                    speed: self
                        .recent_speed
                        .map(|speed| format!("{speed:.2}x"))
                        .or_else(|| self.speed.clone()),
                    eta_seconds,
                    frame: self.frame,
                });
            }
            _ => {}
        }

        None
    }

    fn estimated_seconds_remaining(&self, duration_seconds: f64) -> Option<f64> {
        if duration_seconds <= 0.0 {
            return None;
        }

        let speed = self.recent_speed.or_else(|| {
            self.speed
                .as_deref()?
                .trim_end_matches('x')
                .parse::<f64>()
                .ok()
        })?;
        if !speed.is_finite() || speed <= 0.0 {
            return None;
        }

        Some(((duration_seconds - self.out_time_seconds).max(0.0) / speed).max(0.0))
    }
}

#[cfg(test)]
mod tests {
    use super::ProgressParser;
    use std::time::{Duration, Instant};

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
        assert!(!progress.indeterminate);
        assert_eq!(progress.speed.as_deref(), Some("2.0x"));
        assert_eq!(progress.eta_seconds, Some(7.5));
    }

    #[test]
    fn eta_recovers_from_a_pause_instead_of_using_lifetime_speed() {
        let mut parser = ProgressParser::default();
        parser.update("job-1", 60.0, "out_time_us=10000000");
        parser.update("job-1", 60.0, "speed=0.05x");
        parser.last_sample = Some((Instant::now() - Duration::from_secs(2), 6.0));

        let progress = parser.update("job-1", 60.0, "progress=continue").unwrap();
        let eta = progress.eta_seconds.unwrap();
        assert!(
            (25.0..26.0).contains(&eta),
            "recent speed should give about 25s, got {eta}"
        );
    }

    #[test]
    fn emits_indeterminate_activity_when_duration_is_unknown() {
        let mut parser = ProgressParser {
            started_at: Instant::now() - Duration::from_secs(4),
            ..ProgressParser::default()
        };
        assert!(parser.update("job-1", 0.0, "out_time_us=5000000").is_none());
        assert!(parser.update("job-1", 0.0, "frame=150").is_none());
        assert!(parser.update("job-1", 0.0, "speed=2.0x").is_none());

        let progress = parser
            .update("job-1", 0.0, "progress=continue")
            .expect("an indeterminate progress payload");

        assert!(progress.indeterminate);
        assert!(progress.elapsed_seconds >= 4.0);
        assert_eq!(progress.out_time_seconds, 5.0);
        assert_eq!(progress.frame, Some(150));
        assert_eq!(progress.eta_seconds, None);
    }

    #[test]
    fn measures_progress_against_the_trimmed_duration() {
        let mut parser = ProgressParser::default();
        let segment_seconds = 30.0;
        assert!(parser
            .update("job-1", segment_seconds, "out_time_us=15000000")
            .is_none());
        assert!(parser
            .update("job-1", segment_seconds, "speed=1.0x")
            .is_none());

        let progress = parser
            .update("job-1", segment_seconds, "progress=continue")
            .expect("a progress payload");

        assert_eq!(progress.percent, 50.0);
        assert_eq!(progress.eta_seconds, Some(15.0));
        assert_eq!(progress.out_time_seconds, 15.0);
    }

    #[test]
    fn reports_one_hundred_percent_at_the_end() {
        let mut parser = ProgressParser::default();
        let progress = parser
            .update("job-1", 20.0, "progress=end")
            .expect("a final progress payload");
        assert_eq!(progress.percent, 100.0);
        assert!(!progress.indeterminate);
        assert_eq!(progress.eta_seconds, Some(0.0));
    }

    #[test]
    fn omits_eta_until_speed_is_available() {
        let mut parser = ProgressParser::default();
        assert!(parser
            .update("job-1", 20.0, "out_time_us=5000000")
            .is_none());

        let progress = parser
            .update("job-1", 20.0, "progress=continue")
            .expect("a progress payload");
        assert_eq!(progress.eta_seconds, None);
    }
}
