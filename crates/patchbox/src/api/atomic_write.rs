//! Atomic file writes using the .tmp + rename pattern.
//!
//! This module provides crash-safe file writing: content is written to a temporary file,
//! then atomically renamed to the final location. If the process crashes during write,
//! only the incomplete .tmp file is left behind; the original file remains intact.
//!
//! On Unix systems, fsync() is called after writing to ensure durability guarantees.

use std::io;
use std::path::Path;

/// Atomically write content to a file.
///
/// **Safety guarantee:** If this function succeeds, the file at `path` contains the complete
/// `content`. If the process crashes at any point during execution:
/// - Before sync: the incomplete `.tmp` file is left behind, original unchanged
/// - After sync (Unix): the content is guaranteed to reach storage before returning
///
/// # Arguments
/// * `path` - Target file path (must end with desired extension, e.g., ".json" or ".toml")
/// * `content` - Content to write
///
/// # Errors
/// Returns I/O errors from write, sync, or rename operations.
///
/// # Example
/// ```ignore
/// atomic_write(Path::new("/etc/config.toml"), "key = \"value\"")?;
/// ```
#[allow(dead_code)]
pub fn atomic_write(path: &Path, content: &str) -> io::Result<()> {
    // Create temporary file path by appending .tmp
    let tmp_path = path.with_extension(format!(
        "{}.tmp",
        path.extension()
            .and_then(|s| s.to_str())
            .unwrap_or("tmp")
    ));

    // Write to temporary file
    std::fs::write(&tmp_path, content)?;

    // On Unix, fsync to ensure durability
    #[cfg(unix)]
    {
        let file = std::fs::OpenOptions::new()
            .write(true)
            .open(&tmp_path)?;
        #[allow(unused_imports)]
        use std::os::unix::fs::OpenOptionsExt;
        file.sync_all()?;
    }

    // Atomically rename temp file to target
    std::fs::rename(&tmp_path, path)?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::TempDir;

    #[test]
    fn test_atomic_write_success() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("test.json");
        let content = r#"{"key": "value"}"#;

        atomic_write(&path, content).unwrap();

        assert!(path.exists());
        assert_eq!(fs::read_to_string(&path).unwrap(), content);
    }

    #[test]
    fn test_atomic_write_tmp_cleanup() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("test.toml");
        let tmp_path = path.with_extension("toml.tmp");
        let content = "[section]\nkey = 123";

        atomic_write(&path, content).unwrap();

        assert!(path.exists());
        assert!(!tmp_path.exists(), ".tmp file should be cleaned up after rename");
    }

    #[test]
    fn test_atomic_write_replaces_existing() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("test.json");
        let old_content = r#"{"old": "data"}"#;
        let new_content = r#"{"new": "data"}"#;

        fs::write(&path, old_content).unwrap();
        atomic_write(&path, new_content).unwrap();

        assert_eq!(fs::read_to_string(&path).unwrap(), new_content);
    }

    #[test]
    fn test_atomic_write_handles_no_extension() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("testfile");
        let content = "some content";

        atomic_write(&path, content).unwrap();

        assert!(path.exists());
        assert_eq!(fs::read_to_string(&path).unwrap(), content);
    }
}
