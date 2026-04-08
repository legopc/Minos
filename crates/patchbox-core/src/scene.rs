//! Scene persistence: named parameter snapshots saved as TOML files.

use crate::control::AudioParams;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use thiserror::Error;

#[derive(Debug, Error)]
pub enum SceneError {
    #[error("I/O error: {0}")]
    Io(#[from] std::io::Error),
    #[error("TOML parse error: {0}")]
    Parse(#[from] toml::de::Error),
    #[error("TOML serialize error: {0}")]
    Serialize(#[from] toml::ser::Error),
    #[error("Scene not found: {0}")]
    NotFound(String),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Scene {
    pub name:   String,
    pub params: AudioParams,
}

/// Save a scene to `{dir}/{name}.toml`.
pub fn save(dir: &Path, scene: &Scene) -> Result<(), SceneError> {
    std::fs::create_dir_all(dir)?;
    let path = scene_path(dir, &scene.name);
    let toml = toml::to_string_pretty(scene)?;
    std::fs::write(path, toml)?;
    Ok(())
}

/// Load a scene from `{dir}/{name}.toml`.
pub fn load(dir: &Path, name: &str) -> Result<Scene, SceneError> {
    let path = scene_path(dir, name);
    if !path.exists() {
        return Err(SceneError::NotFound(name.to_owned()));
    }
    let src = std::fs::read_to_string(&path)?;
    let scene = toml::from_str(&src)?;
    Ok(scene)
}

/// List all scene names in the directory (filenames without `.toml` extension).
pub fn list(dir: &Path) -> Vec<String> {
    let Ok(entries) = std::fs::read_dir(dir) else { return Vec::new(); };
    entries
        .flatten()
        .filter_map(|e| {
            let p = e.path();
            if p.extension()? == "toml" {
                p.file_stem()?.to_str().map(str::to_owned)
            } else {
                None
            }
        })
        .collect()
}

fn scene_path(dir: &Path, name: &str) -> PathBuf {
    dir.join(format!("{}.toml", name))
}
