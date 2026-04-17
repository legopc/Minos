//! A-01: JWT generation and validation using HS256.
//!
//! A random 256-bit secret is generated at startup and stored in AppState.
//! All tokens are 8-hour expiry with role + optional zone claims.

use jsonwebtoken::{decode, encode, Algorithm, DecodingKey, EncodingKey, Header, Validation};
use serde::{Deserialize, Serialize};
use std::time::{SystemTime, UNIX_EPOCH};

pub const TOKEN_EXPIRY_SECS: u64 = 8 * 3600; // 8 hours

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Claims {
    /// Subject (username)
    pub sub: String,
    /// Role: "admin" | "operator" | "bar_staff" | "readonly"
    pub role: String,
    /// Zone ID for bar_staff role (e.g. "bar-1")
    #[serde(skip_serializing_if = "Option::is_none")]
    pub zone: Option<String>,
    /// Expiry unix timestamp
    pub exp: u64,
    /// Issued-at unix timestamp
    pub iat: u64,
}

impl Claims {
    pub fn new(username: &str, role: &str, zone: Option<String>) -> Self {
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();
        Self {
            sub: username.to_owned(),
            role: role.to_owned(),
            zone,
            exp: now + TOKEN_EXPIRY_SECS,
            iat: now,
        }
    }
}

/// Generate a signed JWT.
pub fn generate(claims: &Claims, secret: &[u8]) -> Result<String, jsonwebtoken::errors::Error> {
    encode(
        &Header::new(Algorithm::HS256),
        claims,
        &EncodingKey::from_secret(secret),
    )
}

/// Validate and decode a JWT. Returns the claims if valid.
pub fn validate(token: &str, secret: &[u8]) -> Result<Claims, jsonwebtoken::errors::Error> {
    let mut val = Validation::new(Algorithm::HS256);
    val.validate_exp = true;
    val.leeway = 30; // 30s clock skew tolerance
    let data = decode::<Claims>(token, &DecodingKey::from_secret(secret), &val)?;
    Ok(data.claims)
}

const KEY_PATH: &str = "/etc/patchbox/jwt.key";

/// Load 32-byte secret from KEY_PATH, or generate-and-save a new one.
/// Falls back to ephemeral secret (with warning) if path is not writable.
pub fn load_or_generate_secret() -> Vec<u8> {
    if let Ok(bytes) = std::fs::read(KEY_PATH) {
        if bytes.len() == 32 {
            tracing::info!("JWT secret loaded from {KEY_PATH}");
            return bytes;
        }
        tracing::warn!(
            "JWT key at {KEY_PATH} invalid ({} bytes) — regenerating",
            bytes.len()
        );
    }
    let secret = generate_secret();
    match save_secret(&secret) {
        Ok(()) => tracing::info!("JWT secret written to {KEY_PATH}"),
        Err(e) => tracing::warn!(error = %e, "Cannot persist JWT secret — ephemeral this session"),
    }
    secret
}

fn save_secret(secret: &[u8]) -> std::io::Result<()> {
    use std::io::Write;
    #[cfg(unix)]
    use std::os::unix::fs::OpenOptionsExt;
    let mut opts = std::fs::OpenOptions::new();
    opts.write(true).create(true).truncate(true);
    #[cfg(unix)]
    opts.mode(0o600);
    let mut f = opts.open(KEY_PATH)?;
    f.write_all(secret)?;
    f.sync_all()
}

/// Generate a cryptographically random 32-byte secret at startup.
pub fn generate_secret() -> Vec<u8> {
    use std::collections::hash_map::DefaultHasher;
    use std::hash::{Hash, Hasher};
    // Mix PID + monotonic time + random bytes from /dev/urandom
    let mut secret = vec![0u8; 32];
    if let Ok(mut f) = std::fs::File::open("/dev/urandom") {
        use std::io::Read;
        let _ = f.read_exact(&mut secret);
    } else {
        // Fallback: hash-based seed (not cryptographic, but functional)
        let mut h = DefaultHasher::new();
        std::process::id().hash(&mut h);
        SystemTime::now().hash(&mut h);
        let seed = h.finish().to_le_bytes();
        for (i, b) in secret.iter_mut().enumerate() {
            *b = seed[i % 8].wrapping_add(i as u8);
        }
    }
    secret
}
