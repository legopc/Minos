use patchbox_core::config::{
    default_hpf, default_lpf, AecConfig, AutomixerChannelConfig, CompressorConfig, DelayConfig,
    DynamicEqConfig, EqConfig, FeedbackSuppressorConfig, FilterConfig, GateConfig, LimiterConfig,
};
use serde::Serialize;
use serde_json::Value;
use std::collections::BTreeMap;
use std::env;
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize)]
struct FltParams {
    hpf: FilterConfig,
    lpf: FilterConfig,
}

impl Default for FltParams {
    fn default() -> Self {
        Self {
            hpf: default_hpf(),
            lpf: default_lpf(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Default)]
struct AmParams {
    gain_db: f32,
    invert_polarity: bool,
}

#[derive(Debug, Clone, Serialize)]
struct DlyParams {
    delay_ms: f32,
    bypassed: bool,
    dither_bits: u8,
}

impl Default for DlyParams {
    fn default() -> Self {
        let d = DelayConfig::default();
        Self {
            delay_ms: d.delay_ms,
            bypassed: !d.enabled,
            dither_bits: 0,
        }
    }
}

fn default_out_path() -> PathBuf {
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    manifest_dir
        .join("..")
        .join("..")
        .join("web")
        .join("src")
        .join("generated")
        .join("dsp-defaults.json")
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let out_path = env::args()
        .nth(1)
        .map(PathBuf::from)
        .unwrap_or_else(default_out_path);
    let out_dir = out_path
        .parent()
        .map(Path::to_path_buf)
        .unwrap_or_else(|| PathBuf::from("."));

    fs::create_dir_all(&out_dir)?;

    let mut defaults: BTreeMap<String, Value> = BTreeMap::new();
    defaults.insert(
        "flt".to_string(),
        serde_json::to_value(FltParams::default())?,
    );
    defaults.insert("am".to_string(), serde_json::to_value(AmParams::default())?);
    defaults.insert(
        "peq".to_string(),
        serde_json::to_value(EqConfig::default())?,
    );
    defaults.insert(
        "gte".to_string(),
        serde_json::to_value(GateConfig::default())?,
    );
    defaults.insert(
        "cmp".to_string(),
        serde_json::to_value(CompressorConfig::default())?,
    );
    defaults.insert(
        "aec".to_string(),
        serde_json::to_value(AecConfig::default())?,
    );
    defaults.insert(
        "axm".to_string(),
        serde_json::to_value(AutomixerChannelConfig::default())?,
    );
    defaults.insert(
        "afs".to_string(),
        serde_json::to_value(FeedbackSuppressorConfig::default())?,
    );
    defaults.insert(
        "deq".to_string(),
        serde_json::to_value(DynamicEqConfig::default())?,
    );
    defaults.insert(
        "lim".to_string(),
        serde_json::to_value(LimiterConfig::default())?,
    );
    defaults.insert(
        "dly".to_string(),
        serde_json::to_value(DlyParams::default())?,
    );

    let json = serde_json::to_string_pretty(&defaults)? + "\n";
    fs::write(&out_path, json)?;

    eprintln!("wrote {}", out_path.display());
    Ok(())
}
