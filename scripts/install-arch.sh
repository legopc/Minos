#!/usr/bin/env bash
# install-arch.sh — Deploy or update Minos (dante-patchbox) on Arch Linux
#
# Idempotent: safe to re-run after a fresh install OR to update to the latest
# commit. On first run everything is installed from scratch. On re-runs only
# changed binaries are rebuilt and only affected services are restarted.
#
# Usage:
#   Fresh node:   sudo bash scripts/install-arch.sh
#   Update node:  sudo bash scripts/install-arch.sh          (pulls latest git first)
#
# After first install:
#   Edit /etc/patchbox/config.toml — set dante_nic (ip link) and dante_name
#   Edit /etc/statime/statime.toml  — set interface= to your NIC
#   sudo systemctl restart statime patchbox

set -euo pipefail

# ── Resolve repo root (works regardless of cwd) ──────────────────────────────
REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PATCHBOX_BINARY="$REPO_DIR/target/release/patchbox"

STATIME_REPO="https://github.com/legopc/inferno-ptpv1-master.git"
STATIME_SRC="/opt/inferno-ptpv1-master"
STATIME_BINARY="/usr/local/bin/statime"

PATCHBOX_CONFIG_DIR="/etc/patchbox"
STATIME_CONFIG_DIR="/etc/statime"
PATCHBOX_SERVICE="/etc/systemd/system/patchbox.service"
STATIME_SERVICE="/etc/systemd/system/statime.service"
PAM_FILE="/etc/pam.d/patchbox"

# Run git/cargo as the invoking user, not root
RUN_AS="${SUDO_USER:-$(whoami)}"

echo "==> dante-patchbox (Minos) deploy on Arch Linux"
echo "    Repo:    $REPO_DIR"
echo "    Run as:  $RUN_AS"

# ── 1. Git pull ───────────────────────────────────────────────────────────────
echo "==> Pulling latest commits..."
if [ -d "$REPO_DIR/.git" ]; then
    sudo -u "$RUN_AS" git -C "$REPO_DIR" pull --ff-only \
        || echo "    (git pull skipped — detached HEAD, local changes, or no remote)"
else
    echo "    Not a git repo — skipping pull."
fi

# ── 2. System packages ────────────────────────────────────────────────────────
echo "==> Installing system packages..."
pacman -S --needed --noconfirm \
    base-devel git rust clang lld pkg-config openssl pam rsync

# ── 3. Build patchbox ─────────────────────────────────────────────────────────
echo "==> Building patchbox (with inferno feature — real Dante audio)..."
cd "$REPO_DIR"
PATCHBOX_OLD_HASH=""
[ -f "$PATCHBOX_BINARY" ] && PATCHBOX_OLD_HASH=$(sha256sum "$PATCHBOX_BINARY" | cut -d' ' -f1)

sudo -u "$RUN_AS" cargo build --release --features patchbox-dante/inferno

echo "    Binary: $PATCHBOX_BINARY"
PATCHBOX_NEW_HASH=$(sha256sum "$PATCHBOX_BINARY" | cut -d' ' -f1)
PATCHBOX_CHANGED=false
[ "$PATCHBOX_OLD_HASH" != "$PATCHBOX_NEW_HASH" ] && PATCHBOX_CHANGED=true
$PATCHBOX_CHANGED && echo "    patchbox binary updated." || echo "    patchbox binary unchanged."

# ── 4. Build statime ──────────────────────────────────────────────────────────
echo "==> Setting up statime PTP daemon..."
if [ ! -d "$STATIME_SRC/.git" ]; then
    echo "    Cloning statime repo..."
    sudo -u "$RUN_AS" git clone "$STATIME_REPO" "$STATIME_SRC"
else
    echo "    Pulling statime repo..."
    sudo -u "$RUN_AS" git -C "$STATIME_SRC" pull --ff-only \
        || echo "    (git pull skipped)"
fi

STATIME_OLD_HASH=""
[ -f "$STATIME_BINARY" ] && STATIME_OLD_HASH=$(sha256sum "$STATIME_BINARY" | cut -d' ' -f1)

cd "$STATIME_SRC"
sudo -u "$RUN_AS" cargo build --release -p statime-linux
install -m 755 "$STATIME_SRC/target/release/statime" "$STATIME_BINARY"

STATIME_NEW_HASH=$(sha256sum "$STATIME_BINARY" | cut -d' ' -f1)
STATIME_CHANGED=false
[ "$STATIME_OLD_HASH" != "$STATIME_NEW_HASH" ] && STATIME_CHANGED=true
$STATIME_CHANGED && echo "    statime binary updated." || echo "    statime binary unchanged."

# ── 5. Capabilities ───────────────────────────────────────────────────────────
echo "==> Setting capabilities on patchbox binary..."
setcap cap_net_raw,cap_sys_nice+ep "$PATCHBOX_BINARY"
getcap "$PATCHBOX_BINARY"

# ── 6. Patchbox config ────────────────────────────────────────────────────────
echo "==> Installing patchbox config..."
mkdir -p "$PATCHBOX_CONFIG_DIR"
if [ ! -f "$PATCHBOX_CONFIG_DIR/config.toml" ]; then
    cp "$REPO_DIR/config.toml.example" "$PATCHBOX_CONFIG_DIR/config.toml"
    chmod 640 "$PATCHBOX_CONFIG_DIR/config.toml"
    echo "    Created $PATCHBOX_CONFIG_DIR/config.toml"
    echo "    !! Edit dante_nic (ip link) and dante_name before starting."
else
    echo "    Config exists — not overwriting."
    chmod 640 "$PATCHBOX_CONFIG_DIR/config.toml"
fi

# ── 7. Statime config ─────────────────────────────────────────────────────────
echo "==> Installing statime config..."
mkdir -p "$STATIME_CONFIG_DIR"
if [ ! -f "$STATIME_CONFIG_DIR/statime.toml" ]; then
    cp "$REPO_DIR/config/statime.toml.example" "$STATIME_CONFIG_DIR/statime.toml"
    echo "    Created $STATIME_CONFIG_DIR/statime.toml"
    echo "    !! Edit interface= to match your NIC (ip link)."
else
    echo "    Statime config exists — not overwriting."
fi

# ── 8. PAM service ────────────────────────────────────────────────────────────
echo "==> Installing PAM service..."
if [ ! -f "$PAM_FILE" ]; then
    tee "$PAM_FILE" > /dev/null <<'PAMEOF'
auth    required  pam_unix.so
account required  pam_unix.so
PAMEOF
    echo "    Created $PAM_FILE"
else
    echo "    PAM config exists — not overwriting."
fi

# ── 9. Systemd services ───────────────────────────────────────────────────────
echo "==> Installing systemd services..."
tee "$STATIME_SERVICE" > /dev/null <<EOF
[Unit]
Description=Statime PTP daemon (Inferno fork — PTPv1 support)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=root
ExecStart=$STATIME_BINARY -c $STATIME_CONFIG_DIR/statime.toml
Restart=on-failure
RestartSec=5
StandardOutput=journal
StandardError=journal
SyslogIdentifier=statime

[Install]
WantedBy=multi-user.target
EOF

tee "$PATCHBOX_SERVICE" > /dev/null <<EOF
[Unit]
Description=Minos Dante Patchbay
Documentation=https://github.com/legopc/dante-patchbox
After=network.target statime.service

[Service]
ExecStart=$PATCHBOX_BINARY --config $PATCHBOX_CONFIG_DIR/config.toml
Restart=on-failure
RestartSec=3
AmbientCapabilities=CAP_NET_RAW CAP_SYS_NICE
StandardOutput=journal
StandardError=journal
SyslogIdentifier=patchbox

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable statime patchbox
echo "    Services installed and enabled."

# ── 10. Restart changed services ──────────────────────────────────────────────
echo "==> Restarting services..."
if $STATIME_CHANGED || ! systemctl is-active --quiet statime; then
    systemctl restart statime
    echo "    statime restarted."
else
    echo "    statime unchanged — not restarting."
fi

# Always restart patchbox: config or web assets may have changed even if binary hash is same
systemctl restart patchbox
echo "    patchbox restarted."
sleep 3

# ── 11. Health check ──────────────────────────────────────────────────────────
PATCHBOX_OK=false
STATIME_OK=false
systemctl is-active --quiet patchbox && PATCHBOX_OK=true
systemctl is-active --quiet statime  && STATIME_OK=true

NODE_IP=$(ip route get 1 2>/dev/null | awk '/src/{print $7}' | head -1)

echo ""
echo "==> Deploy complete!"
echo "    patchbox: $(systemctl is-active patchbox)"
echo "    statime:  $(systemctl is-active statime)"
echo ""
echo "    Web UI:  http://${NODE_IP}:${PATCHBOX_PORT:-9191}"
echo "    Config:  $PATCHBOX_CONFIG_DIR/config.toml"
echo "    Logs:    journalctl -u patchbox -f"
echo "             journalctl -u statime  -f"

if ! $PATCHBOX_OK || ! $STATIME_OK; then
    echo ""
    echo "    WARNING: one or more services not active — check logs above."
    systemctl status patchbox statime --no-pager -l | head -30
    exit 1
fi

if ! systemctl is-active --quiet patchbox; then
    :  # already reported above
else
    echo ""
    echo "    FIRST-TIME CHECKLIST:"
    echo "    1. edit $PATCHBOX_CONFIG_DIR/config.toml  (dante_nic, dante_name)"
    echo "    2. edit $STATIME_CONFIG_DIR/statime.toml   (interface=)"
    echo "    3. sudo systemctl restart statime patchbox"
fi

