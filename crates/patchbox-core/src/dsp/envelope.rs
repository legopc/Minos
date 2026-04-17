//! Uniform JSON envelope for every DSP block.
//!
//! Wire format (new):
//! ```json
//! {"kind":"compressor","enabled":true,"version":1,"params":{...}}
//! ```
//! Old flat format (backward-compat):
//! ```json
//! {"enabled":true,"threshold_db":-18.0,"ratio":4.0,...}
//! ```

use serde::{Deserialize, Deserializer, Serialize};

/// Uniform envelope wrapping any DSP block's params.
#[derive(Debug, Clone, Serialize)]
pub struct DspBlock<P> {
    pub kind: String,
    pub enabled: bool,
    /// Per-block schema version. Defaults to `1` when absent.
    pub version: u32,
    pub params: P,
}

impl<P: Default> Default for DspBlock<P> {
    fn default() -> Self {
        Self {
            kind: String::new(),
            enabled: true,
            version: 1,
            params: P::default(),
        }
    }
}

impl<'de, P: Deserialize<'de>> Deserialize<'de> for DspBlock<P> {
    fn deserialize<D: Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        use serde::de::Error;
        let v: serde_json::Value = Deserialize::deserialize(d)?;

        if v.get("params").is_some() {
            // New envelope format
            let kind = v
                .get("kind")
                .and_then(|k| k.as_str())
                .unwrap_or("")
                .to_owned();
            let enabled = v.get("enabled").and_then(|e| e.as_bool()).unwrap_or(true);
            let version = v.get("version").and_then(|ver| ver.as_u64()).unwrap_or(1) as u32;
            let params = P::deserialize(v["params"].clone()).map_err(D::Error::custom)?;
            Ok(Self {
                kind,
                enabled,
                version,
                params,
            })
        } else {
            // Old flat format
            let enabled = v.get("enabled").and_then(|e| e.as_bool()).unwrap_or(true);
            let params = P::deserialize(v).map_err(D::Error::custom)?;
            Ok(Self {
                kind: String::new(),
                enabled,
                version: 1,
                params,
            })
        }
    }
}

/// Opaque DSP block envelope for OpenAPI schema generation.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, utoipa::ToSchema)]
pub struct DspBlockAny {
    pub kind: String,
    pub enabled: bool,
    pub version: u32,
    #[schema(value_type = Object)]
    pub params: serde_json::Value,
}
#[cfg(test)]
mod tests {
    use super::DspBlock;

    #[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq)]
    struct FakeParams {
        #[serde(default)]
        pub enabled: bool,
        pub value: f32,
    }

    #[test]
    fn round_trip_new_envelope() {
        let json =
            r#"{"kind":"fake","enabled":true,"version":1,"params":{"enabled":true,"value":2.5}}"#;
        let block: DspBlock<FakeParams> = serde_json::from_str(json).unwrap();
        assert_eq!(block.kind, "fake");
        assert!(block.enabled);
        assert_eq!(block.version, 1);
        assert!((block.params.value - 2.5).abs() < 0.001);
        let out = serde_json::to_string(&block).unwrap();
        assert!(out.contains(r#""kind":"fake""#));
        assert!(out.contains(r#""version":1"#));
        assert!(out.contains(r#""params":"#));
    }

    #[test]
    fn round_trip_old_flat() {
        let json = r#"{"enabled":false,"value":1.0}"#;
        let block: DspBlock<FakeParams> = serde_json::from_str(json).unwrap();
        assert!(!block.enabled);
        assert_eq!(block.version, 1);
        assert!((block.params.value - 1.0).abs() < 0.001);
    }

    #[test]
    fn missing_version_defaults_to_1() {
        let json = r#"{"kind":"x","enabled":true,"params":{"enabled":true,"value":0.5}}"#;
        let block: DspBlock<FakeParams> = serde_json::from_str(json).unwrap();
        assert_eq!(block.version, 1);
    }

    #[test]
    fn serialize_emits_all_fields() {
        let block = DspBlock {
            kind: "gate".to_owned(),
            enabled: false,
            version: 1,
            params: FakeParams {
                enabled: false,
                value: 2.0,
            },
        };
        let s = serde_json::to_string(&block).unwrap();
        assert!(s.contains(r#""kind":"gate""#));
        assert!(s.contains(r#""enabled":false"#));
        assert!(s.contains(r#""version":1"#));
        assert!(s.contains(r#""params":"#));
    }
}
