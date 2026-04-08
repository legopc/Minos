#!/bin/bash
# Deploy: build and hot-restart patchbox
# Usage: ./deploy.sh
set -e
cd /home/legopc/dante-patchbox

echo "[deploy] Building release binary..."
cargo build --release

echo "[deploy] Stopping current server..."
CURRENT_PID=$(cat /tmp/patchbox.pid 2>/dev/null || true)
if [ -n "$CURRENT_PID" ] && [ -d "/proc/$CURRENT_PID" ]; then
    kill "$CURRENT_PID" && sleep 1
fi
rm -f /tmp/patchbox.pid

echo "[deploy] Waiting for watchdog to restart with new binary..."
sleep 3

# Wait up to 15s for server to come up
for i in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15; do
    if curl -sf http://localhost:9191/api/v1/state > /dev/null 2>&1; then
        echo "[deploy] Server is up — deploy complete."
        exit 0
    fi
    sleep 1
done
echo "[deploy] WARNING: server did not respond after 15s. Check /tmp/patchbox.log"
exit 1
