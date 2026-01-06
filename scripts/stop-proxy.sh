#!/usr/bin/env bash
#
# Stop the running Gradle proxy.
#

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
PID_FILE="$PROJECT_DIR/proxy.pid"

if [[ ! -f "$PID_FILE" ]]; then
    echo "[gradle-proxy] Not running (no PID file)"
    exit 0
fi

PID=$(cat "$PID_FILE")

if kill -0 "$PID" 2>/dev/null; then
    echo "[gradle-proxy] Stopping proxy (PID $PID)..."
    kill "$PID"
    rm -f "$PID_FILE"
    echo "[gradle-proxy] Stopped"
else
    echo "[gradle-proxy] Process $PID not running, cleaning up"
    rm -f "$PID_FILE"
fi
