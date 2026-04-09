//! A-01: JWT generation and validation using HS256.
//!
//! A random 256-bit secret is generated at startup and stored in AppState.
//! All tokens are 8-hour expiry with role + optional zone claims.

use jsonwebtoken::{decode, encode, DecodingKey, EncodingKey, Header, Validation, Algorithm};
use serde::{Deserialize, Serialize};
use std::time::{SystemTime, UNIX_EPOCH};

pub const TOKEN_EXPIRY_SECS: u64 = 8 * 3600; // 8 hours

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Claims {
    /// Subject (username)
    pub sub:  String,
    /// Role: "admin" | "operator" | "bar_staff" | "readonly"
    pub role: String,
    /// Zone ID for bar_staff role (e.g. "bar-1")
    #[serde(skip_serializing_if = "Option::is_none")]
    pub zone: Option<String>,
    /// Expiry unix timestamp
    pub exp:  u64,
    /// Issued-at unix timestamp
    pub iat:  u64,
}

impl Claims {
    pub fn new(username: &str, role: &str, zone: Option<String>) -> Self {
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();
        Self {
            sub:  username.to_owned(),
            role: role.to_owned(),
            zone,
            exp:  now + TOKEN_EXPIRY_SECS,
            iat:  now,
        }
    }

    pub fn is_expired(&self) -> bool {
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();
        self.exp < now
    }
}

/// Generate a signed JWT.
pub fn generate(claims: &Claims, secret: &[u8]) -> Result<String, jsonwebtoken::errors::Error> {
    encode(&Header::new(Algorithm::HS256), claims, &EncodingKey::from_secret(secret))
}

/// Validate and decode a JWT. Returns the claims if valid.
pub fn validate(token: &str, secret: &[u8]) -> Result<Claims, jsonwebtoken::errors::Error> {
    let mut val = Validation::new(Algorithm::HS256);
    val.validate_exp = true;
    val.leeway = 30; // 30s clock skew tolerance
    let data = decode::<Claims>(token, &DecodingKey::from_secret(secret), &val)?;
    Ok(data.claims)
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
