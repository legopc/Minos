// S7 s7-arch-dsp-envelope — DspBlock envelope round-trip tests.
use patchbox_core::dsp::DspBlock;
use patchbox_core::config::{
    FilterConfig, EqConfig, GateConfig, CompressorConfig, LimiterConfig, DelayConfig,
};

fn roundtrip<T: serde::Serialize + serde::de::DeserializeOwned>(flat_json: &str) {
    let block: DspBlock<T> = serde_json::from_str(flat_json).expect("flat deserialise");
    let v = serde_json::to_value(&block).expect("serialize");
    assert!(v.get("kind").is_some(), "missing kind");
    assert!(v.get("enabled").is_some(), "missing enabled");
    assert_eq!(v["version"], 1, "version should be 1");
    assert!(v.get("params").is_some(), "missing params");
}

fn envelope_roundtrip<T: serde::Serialize + serde::de::DeserializeOwned>(envelope_json: &str) {
    let block: DspBlock<T> = serde_json::from_str(envelope_json).expect("envelope deserialise");
    let v = serde_json::to_value(&block).expect("serialize");
    assert!(v.get("kind").is_some(), "missing kind");
    assert_eq!(v["enabled"], true);
    assert_eq!(v["version"], 1);
    assert!(v.get("params").is_some(), "missing params");
}

#[test]
fn filter_flat_roundtrip() {
    roundtrip::<FilterConfig>(r#"{"enabled":true,"freq_hz":120.0,"order":2}"#);
}

#[test]
fn filter_envelope_roundtrip() {
    envelope_roundtrip::<FilterConfig>(
        r#"{"kind":"flt","enabled":true,"version":1,"params":{"enabled":true,"freq_hz":120.0,"order":2}}"#,
    );
}

#[test]
fn eq_flat_roundtrip() {
    roundtrip::<EqConfig>(r#"{"enabled":true,"bands":[]}"#);
}

#[test]
fn gate_flat_roundtrip() {
    roundtrip::<GateConfig>(
        r#"{"enabled":true,"threshold_db":-40.0,"attack_ms":5.0,"release_ms":100.0,"hold_ms":50.0,"range_db":-60.0}"#,
    );
}

#[test]
fn compressor_flat_roundtrip() {
    roundtrip::<CompressorConfig>(
        r#"{"enabled":true,"threshold_db":-20.0,"ratio":4.0,"attack_ms":10.0,"release_ms":100.0,"makeup_gain_db":0.0,"knee_db":3.0}"#,
    );
}

#[test]
fn limiter_flat_roundtrip() {
    roundtrip::<LimiterConfig>(
        r#"{"enabled":true,"threshold_db":-3.0,"attack_ms":1.0,"release_ms":50.0}"#,
    );
}

#[test]
fn delay_flat_roundtrip() {
    roundtrip::<DelayConfig>(r#"{"enabled":true,"delay_ms":10.0}"#);
}

#[test]
fn missing_version_defaults_to_1() {
    let json = r#"{"kind":"gte","enabled":true,"params":{"enabled":true,"threshold_db":-40.0,"attack_ms":5.0,"release_ms":100.0,"hold_ms":50.0,"range_db":-60.0}}"#;
    let block: DspBlock<GateConfig> = serde_json::from_str(json).expect("deserialise");
    assert_eq!(block.version, 1);
}

#[test]
fn enabled_from_envelope_wins() {
    let json = r#"{"kind":"cmp","enabled":true,"version":1,"params":{"enabled":false,"threshold_db":-20.0,"ratio":4.0,"attack_ms":10.0,"release_ms":100.0,"makeup_gain_db":0.0,"knee_db":3.0}}"#;
    let block: DspBlock<CompressorConfig> = serde_json::from_str(json).expect("deserialise");
    assert!(block.enabled);
    assert!(!block.params.enabled);
}
