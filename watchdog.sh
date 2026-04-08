#!/bin/bash
# Watchdog: restart patchbox if it crashes
BINARY="/home/legopc/dante-patchbox/target/release/patchbox"
LOG="/tmp/patchbox.log"
PORT=9191

while true; do
    if ! curl -sf http://localhost:$PORT/api/v1/state > /dev/null 2>&1; then
        echo "[$(date -Iseconds)] patchbox not responding — restarting..." >> /tmp/patchbox-watchdog.log
        rm -f /tmp/patchbox.pid
        cd /home/legopc/dante-patchbox
        nohup $BINARY -p $PORT >> $LOG 2>&1 &
        sleep 5
    fi
    sleep 10
done
