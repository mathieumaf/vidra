use crate::error::{ApiError, ApiResult};
use std::sync::Mutex;

#[derive(Default)]
pub struct SleepPreventer {
    assertion: Mutex<Option<platform::Assertion>>,
}

impl SleepPreventer {
    pub fn activate(&self) -> ApiResult<()> {
        let mut assertion = self.lock()?;
        if assertion.is_none() {
            *assertion = Some(platform::create()?);
        }
        Ok(())
    }

    pub fn deactivate(&self) {
        let Ok(mut assertion) = self.lock() else {
            eprintln!("Unable to access the system sleep assertion.");
            return;
        };
        let Some(active) = assertion.as_ref() else {
            return;
        };

        match platform::release(active) {
            Ok(()) => {
                assertion.take();
            }
            Err(error) => {
                eprintln!("Unable to release the system sleep assertion: {error}");
            }
        }
    }

    fn lock(&self) -> ApiResult<std::sync::MutexGuard<'_, Option<platform::Assertion>>> {
        self.assertion.lock().map_err(|_| {
            ApiError::new(
                "sleep_prevention_error",
                "Unable to manage system sleep while converting video.",
            )
        })
    }

    #[cfg(test)]
    pub fn is_active(&self) -> bool {
        self.assertion
            .lock()
            .map(|assertion| assertion.is_some())
            .unwrap_or(false)
    }
}

impl Drop for SleepPreventer {
    fn drop(&mut self) {
        self.deactivate();
    }
}

#[cfg(target_os = "macos")]
mod platform {
    use super::{ApiError, ApiResult};
    use core_foundation::{base::TCFType, string::CFString};
    use core_foundation_sys::string::CFStringRef;

    const ASSERTION_LEVEL_ON: u32 = 255;
    const SUCCESS: i32 = 0;

    pub struct Assertion {
        id: u32,
    }

    #[link(name = "IOKit", kind = "framework")]
    extern "C" {
        fn IOPMAssertionCreateWithName(
            assertion_type: CFStringRef,
            assertion_level: u32,
            assertion_name: CFStringRef,
            assertion_id: *mut u32,
        ) -> i32;

        fn IOPMAssertionRelease(assertion_id: u32) -> i32;
    }

    pub fn create() -> ApiResult<Assertion> {
        let assertion_type = CFString::new("PreventUserIdleSystemSleep");
        let assertion_name = CFString::new("Vidra is converting video");
        let mut assertion_id = 0;
        let result = unsafe {
            IOPMAssertionCreateWithName(
                assertion_type.as_concrete_TypeRef(),
                ASSERTION_LEVEL_ON,
                assertion_name.as_concrete_TypeRef(),
                &mut assertion_id,
            )
        };

        if result == SUCCESS {
            Ok(Assertion { id: assertion_id })
        } else {
            eprintln!("Unable to create the macOS sleep assertion: IOKit error {result}");
            Err(ApiError::new(
                "sleep_prevention_error",
                "Vidra could not prevent the Mac from sleeping during this conversion.",
            ))
        }
    }

    pub fn release(assertion: &Assertion) -> ApiResult<()> {
        let result = unsafe { IOPMAssertionRelease(assertion.id) };
        if result == SUCCESS {
            Ok(())
        } else {
            Err(ApiError::new(
                "sleep_prevention_error",
                format!("macOS returned power management error {result}."),
            ))
        }
    }
}

#[cfg(all(not(target_os = "macos"), not(test)))]
mod platform {
    use super::{ApiError, ApiResult};

    pub struct Assertion;

    pub fn create() -> ApiResult<Assertion> {
        Err(ApiError::new(
            "sleep_prevention_unsupported",
            "Preventing system sleep is not supported on this platform.",
        ))
    }

    pub fn release(_assertion: &Assertion) -> ApiResult<()> {
        Ok(())
    }
}

#[cfg(all(not(target_os = "macos"), test))]
mod platform {
    use super::ApiResult;

    pub struct Assertion;

    pub fn create() -> ApiResult<Assertion> {
        Ok(Assertion)
    }

    pub fn release(_assertion: &Assertion) -> ApiResult<()> {
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::SleepPreventer;

    #[test]
    fn activation_and_deactivation_are_idempotent() {
        let preventer = SleepPreventer::default();

        preventer.activate().unwrap();
        preventer.activate().unwrap();
        assert!(preventer.is_active());

        preventer.deactivate();
        preventer.deactivate();
        assert!(!preventer.is_active());
    }
}
