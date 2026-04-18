use tokio::io::AsyncReadExt;

pub async fn query_ptp_offset(socket_path: &str) -> Option<i64> {
    let connect = tokio::net::UnixStream::connect(socket_path);
    let mut stream = tokio::time::timeout(std::time::Duration::from_millis(100), connect)
        .await
        .ok()?
        .ok()?;

    let mut buf = String::new();
    let read = tokio::time::timeout(
        std::time::Duration::from_millis(200),
        stream.read_to_string(&mut buf),
    )
    .await;
    if read.is_err() {
        return None;
    }

    for line in buf.lines() {
        if line.starts_with("statime_offset_from_master") && !line.starts_with('#') {
            if let Some(val_str) = line.split_whitespace().last() {
                if let Ok(secs) = val_str.parse::<f64>() {
                    return Some((secs * 1_000_000_000.0) as i64);
                }
            }
        }
    }

    None
}

pub async fn query_ptp_state(socket_path: &str) -> Option<String> {
    let connect = tokio::net::UnixStream::connect(socket_path);
    let mut stream = tokio::time::timeout(std::time::Duration::from_millis(100), connect)
        .await
        .ok()?
        .ok()?;

    let mut buf = String::new();
    let read = tokio::time::timeout(
        std::time::Duration::from_millis(200),
        stream.read_to_string(&mut buf),
    )
    .await;
    if read.is_err() {
        return None;
    }

    for line in buf.lines() {
        if line.starts_with("state") && !line.starts_with('#') {
            if let Some(val_str) = line.split_whitespace().last() {
                return Some(val_str.to_string());
            }
        }
    }

    None
}

pub fn is_ptp_locked_state(state: &str) -> bool {
    matches!(state, "SLAVE" | "MASTER")
}
