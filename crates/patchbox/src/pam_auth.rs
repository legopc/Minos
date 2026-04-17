//! A-01: PAM authentication via raw FFI bindings.
//!
//! Links against libpam.so (libpam0g) at runtime.
//! Does NOT require libpam0g-dev headers — bindings are written by hand
//! against the stable POSIX PAM API (unchanged since PAM 0.x).
//!
//! Usage:
//!   pam_auth::authenticate("username", "password").await?
//!
//! Group → role mapping:
//!   patchbox-admin     → Role::Admin
//!   patchbox-operator  → Role::Operator
//!   patchbox-bar-<id>  → Role::BarStaff { zone: id }
//!   (none of the above) → Role::ReadOnly (or Err if auth passes but no group)

use std::ffi::{CString, NulError};
use std::os::raw::{c_char, c_int, c_void};
use thiserror::Error;

// ── Raw PAM FFI ──────────────────────────────────────────────────────────

#[repr(C)]
struct PamMessage {
    msg_style: c_int,
    msg:       *const c_char,
}

#[repr(C)]
struct PamResponse {
    resp:         *mut c_char,
    resp_retcode: c_int,
}

#[repr(C)]
struct PamConv {
    conv:        Option<
        unsafe extern "C" fn(
            num_msg:  c_int,
            msg:      *const *const PamMessage,
            resp:     *mut *mut PamResponse,
            appdata:  *mut c_void,
        ) -> c_int,
    >,
    appdata_ptr: *mut c_void,
}

enum PamHandle {}

extern "C" {
    fn pam_start(
        service_name:     *const c_char,
        user:             *const c_char,
        pam_conversation: *const PamConv,
        pamh:             *mut *mut PamHandle,
    ) -> c_int;

    fn pam_authenticate(pamh: *mut PamHandle, flags: c_int) -> c_int;
    fn pam_acct_mgmt(pamh: *mut PamHandle, flags: c_int) -> c_int;
    fn pam_end(pamh: *mut PamHandle, pam_status: c_int) -> c_int;
}

const PAM_SUCCESS:   c_int = 0;
const PAM_AUTH_ERR:  c_int = 7;
const PAM_USER_UNKNOWN: c_int = 10;

/// Callback state passed to the PAM conversation function.
struct ConvState {
    password: CString,
}

/// PAM conversation function: responds to PAM_PROMPT_ECHO_OFF with the password.
unsafe extern "C" fn pam_conv_fn(
    num_msg:  c_int,
    msg:      *const *const PamMessage,
    resp:     *mut *mut PamResponse,
    appdata:  *mut c_void,
) -> c_int {
    // PAM_PROMPT_ECHO_OFF = 1
    const PROMPT_ECHO_OFF: c_int = 1;

    let state = &*(appdata as *const ConvState);
    let n = num_msg as usize;

    // Allocate responses array (calloc-style: PAM will free these)
    let layout = std::alloc::Layout::array::<PamResponse>(n).unwrap();
    let responses = std::alloc::alloc_zeroed(layout) as *mut PamResponse;
    if responses.is_null() {
        return 4; // PAM_BUF_ERR
    }

    for i in 0..n {
        let m = &**msg.add(i);
        let r = &mut *responses.add(i);
        if m.msg_style == PROMPT_ECHO_OFF {
            // Copy password into malloc'd buffer (PAM will free it)
            let pw_bytes = state.password.as_bytes_with_nul();
            let buf = libc::malloc(pw_bytes.len()) as *mut c_char;
            if buf.is_null() {
                return 4;
            }
            std::ptr::copy_nonoverlapping(pw_bytes.as_ptr() as *const c_char, buf, pw_bytes.len());
            r.resp         = buf;
            r.resp_retcode = 0;
        }
    }

    *resp = responses;
    PAM_SUCCESS
}

// ── Public API ────────────────────────────────────────────────────────────

#[derive(Debug, Error)]
pub enum PamError {
    #[error("invalid credentials")]
    AuthFailed,
    #[error("user unknown")]
    UserUnknown,
    #[error("PAM system error: {0}")]
    System(c_int),
    #[error("string contains null byte")]
    NulError(#[from] NulError),
}

/// Authenticate `username` / `password` against the PAM service `service`
/// (typically "login" or a custom "patchbox" service file).
///
/// Runs in a blocking thread — call via `tokio::task::spawn_blocking`.
pub fn pam_authenticate_sync(
    service:  &str,
    username: &str,
    password: &str,
) -> Result<(), PamError> {
    let c_service  = CString::new(service)?;
    let c_username = CString::new(username)?;

    let conv_state = ConvState {
        password: CString::new(password)?,
    };

    let pam_conversation = PamConv {
        conv:        Some(pam_conv_fn),
        appdata_ptr: &conv_state as *const ConvState as *mut c_void,
    };

    let mut pamh: *mut PamHandle = std::ptr::null_mut();

    let ret = unsafe {
        pam_start(
            c_service.as_ptr(),
            c_username.as_ptr(),
            &pam_conversation,
            &mut pamh,
        )
    };
    if ret != PAM_SUCCESS {
        return Err(PamError::System(ret));
    }

    let auth_ret = unsafe { pam_authenticate(pamh, 0) };
    let acct_ret = if auth_ret == PAM_SUCCESS {
        unsafe { pam_acct_mgmt(pamh, 0) }
    } else {
        auth_ret
    };

    unsafe { pam_end(pamh, acct_ret) };

    match auth_ret {
        PAM_SUCCESS if acct_ret == PAM_SUCCESS => Ok(()),
        PAM_AUTH_ERR   => Err(PamError::AuthFailed),
        PAM_USER_UNKNOWN => Err(PamError::UserUnknown),
        other          => Err(PamError::System(other)),
    }
}

/// Async wrapper — spawns onto a blocking thread.
pub async fn authenticate(
    service:  &str,
    username: &str,
    password: &str,
) -> Result<(), PamError> {
    let service  = service.to_owned();
    let username = username.to_owned();
    let password = password.to_owned();

    tokio::task::spawn_blocking(move || pam_authenticate_sync(&service, &username, &password))
        .await
        .unwrap_or(Err(PamError::System(-1)))
}

// ── Group → role mapping ──────────────────────────────────────────────────

/// Look up Linux groups for a user and derive their patchbox role.
/// Returns (role_str, zone_id_option).
pub fn role_for_user(username: &str) -> (&'static str, Option<String>) {
    // Use `id -Gn <username>` to get group names — no dev headers needed.
    let output = std::process::Command::new("id")
        .arg("-Gn")
        .arg(username)
        .output();

    let groups: Vec<String> = match output {
        Ok(o) if o.status.success() => {
            String::from_utf8_lossy(&o.stdout)
                .split_whitespace()
                .map(|s| s.to_owned())
                .collect()
        }
        _ => vec![],
    };

    // Priority: admin > operator > bar-staff > readonly
    if groups.iter().any(|g| g == "patchbox-admin") {
        return ("admin", None);
    }
    if groups.iter().any(|g| g == "patchbox-operator") {
        return ("operator", None);
    }
    for g in &groups {
        if let Some(zone) = g.strip_prefix("patchbox-bar-") {
            return ("bar_staff", Some(zone.to_owned()));
        }
    }
    ("readonly", None)
}
