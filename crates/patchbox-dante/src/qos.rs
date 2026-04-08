//! D-10: DSCP/QoS markings for Dante network traffic.
//!
//! Since inferno_aoip manages its own sockets internally we cannot call
//! `setsockopt(IP_TOS)` on them directly. Instead, on Linux we apply DSCP
//! marks via nftables at startup (requires `CAP_NET_ADMIN` or root).
//!
//! DSCP values used (Audinate recommendation):
//!   PTP  (UDP 319/320)        → EF   (0x2E = 46, TOS byte 0xB8)
//!   RTP audio (UDP 4321/5004) → AF41 (0x22 = 34, TOS byte 0x88)
//!
//! If nftables is unavailable or permissions are insufficient this function
//! logs a warning and returns without error — QoS marking is best-effort.

use tracing::{info, warn};

const NFT_RULESET: &str = "
table ip dante_qos {
    chain output {
        type filter hook output priority mangle;
        udp dport { 319, 320 } ip dscp set ef
        udp dport { 4321, 5004 } ip dscp set af41
    }
}
";

/// Try to install nftables DSCP marking rules for Dante traffic.
/// Idempotent — the old table is deleted before re-adding.
pub fn apply_dante_dscp() {
    #[cfg(target_os = "linux")]
    {
        // Remove stale table (ignore errors — it may not exist)
        let _ = std::process::Command::new("nft")
            .args(["delete", "table", "ip", "dante_qos"])
            .output();

        let mut child = match std::process::Command::new("nft")
            .args(["-f", "-"])
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::piped())
            .spawn()
        {
            Ok(c) => c,
            Err(e) => {
                warn!("nft not found ({e}); DSCP QoS not applied — install nftables for AoIP QoS");
                return;
            }
        };

        if let Some(ref mut stdin) = child.stdin.take() {
            use std::io::Write;
            let _ = stdin.write_all(NFT_RULESET.as_bytes());
        }

        match child.wait_with_output() {
            Ok(out) if out.status.success() => {
                info!("DSCP QoS rules applied: PTP(319/320)→EF, RTP(4321/5004)→AF41");
            }
            Ok(out) => {
                let stderr = String::from_utf8_lossy(&out.stderr);
                warn!(
                    "nft DSCP rules failed (needs CAP_NET_ADMIN): {}",
                    stderr.trim()
                );
            }
            Err(e) => warn!("nft wait failed: {e}"),
        }
    }

    #[cfg(not(target_os = "linux"))]
    warn!("DSCP QoS only supported on Linux; skipping");
}

