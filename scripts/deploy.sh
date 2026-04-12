#!/usr/bin/env bash
# deploy.sh — Build patchbox locally, push binary + assets to a remote Arch node
#
# Usage:
#   bash scripts/deploy.sh [user@]host
#   bash scripts/deploy.sh legopc@192.168.1.25
#
# Requires:
#   - Rust toolchain with patchbox-dante/inferno feature deps on this machine
#   - SSH access to the target (key or password)
#   - install-arch.sh already run once on the target (services + config in place)
#
# On subsequent deploys this is much faster than building on the target because
# the build happens on a well-resourced machine (build host) and only the
# compiled binary + web assets are transferred.

set -euo pipefail

TARGET="${1:-}"
if [ -z "$TARGET" ]; then
    echo "Usage: bash scripts/deploy.sh [user@]host" >&2
    exit 1
fi

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BINARY="$REPO_DIR/target/release/patchbox"
REMOTE_BINARY="/home/${TARGET##*@}/dante-patchbox/target/release/patchbox"

# ── 1. Build locally ──────────────────────────────────────────────────────────
echo "==> Building patchbox locally (inferno feature)..."
cd "$REPO_DIR"
cargo build --release --features patchbox-dante/inferno
echo "    Done: $BINARY"

# ── 2. Push binary ───────────────────────────────────────────────────────────
echo "==> Pushing binary to $TARGET..."
ssh "$TARGET" "mkdir -p $(dirname "$REMOTE_BINARY")"
rsync -az --progress "$BINARY" "$TARGET:$REMOTE_BINARY"

# ── 3. Run on-device install (skip build) ─────────────────────────────────────
echo "==> Running install-arch.sh --skip-build on $TARGET..."
ssh "$TARGET" "cd ~/dante-patchbox && sudo bash scripts/install-arch.sh --skip-build"

echo ""
echo "==> Deploy complete!"
