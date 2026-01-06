#!/usr/bin/env bash
#
# Start the Gradle proxy in the background.
# Designed to be called from Claude Code startup hooks.
#

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
PID_FILE="$PROJECT_DIR/proxy.pid"
LOG_FILE="$PROJECT_DIR/proxy.log"

# Check if already running
if [[ -f "$PID_FILE" ]]; then
    PID=$(cat "$PID_FILE")
    if kill -0 "$PID" 2>/dev/null; then
        echo "[gradle-proxy] Already running (PID $PID)"
        exit 0
    else
        # Stale PID file
        rm -f "$PID_FILE"
    fi
fi

# Check for Bun
if ! command -v bun &> /dev/null; then
    echo "[gradle-proxy] Error: Bun not found"
    exit 1
fi

# Check environment
if [[ -z "$HTTP_PROXY" ]] && [[ -z "$HTTPS_PROXY" ]]; then
    echo "[gradle-proxy] No proxy environment - skipping"
    exit 0
fi

# Start proxy in background
echo "[gradle-proxy] Starting proxy..."
cd "$PROJECT_DIR"
nohup bun run src/proxy.ts > "$LOG_FILE" 2>&1 &
PROXY_PID=$!

# Save PID
echo "$PROXY_PID" > "$PID_FILE"

# Wait a moment and check if it started
sleep 1
if kill -0 "$PROXY_PID" 2>/dev/null; then
    echo "[gradle-proxy] Started (PID $PROXY_PID)"
    echo "[gradle-proxy] Logs: $LOG_FILE"
else
    echo "[gradle-proxy] Failed to start - check $LOG_FILE"
    rm -f "$PID_FILE"
    exit 1
fi
