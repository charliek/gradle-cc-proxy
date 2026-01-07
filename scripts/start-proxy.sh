#!/usr/bin/env bash
#
# Start the Gradle proxy in the background.
# Designed to be called from Claude Code startup hooks or manually.
#
# The proxy listens on localhost:8899 and forwards requests to the
# upstream JWT-authenticated proxy with proper authorization headers.
#
# Usage:
#   ./start-proxy.sh [options]
#
# Options:
#   --max-concurrent N   Limit concurrent connections (default: 3)
#   --no-throttle        Disable connection throttling (unlimited connections)
#   --verbose            Enable verbose logging
#   --help               Show this help message
#

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
PID_FILE="$PROJECT_DIR/proxy.pid"
LOG_FILE="$PROJECT_DIR/proxy.log"

# Parse arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --max-concurrent)
            export PROXY_MAX_CONCURRENT="$2"
            shift 2
            ;;
        --verbose)
            export VERBOSE="true"
            shift
            ;;
        --no-throttle)
            export PROXY_MAX_CONCURRENT="0"
            shift
            ;;
        --help)
            echo "Usage: $0 [options]"
            echo ""
            echo "Options:"
            echo "  --max-concurrent N   Limit concurrent connections (default: 3)"
            echo "  --no-throttle        Disable connection throttling (unlimited)"
            echo "  --verbose            Enable verbose logging"
            echo "  --help               Show this help message"
            exit 0
            ;;
        *)
            echo "Unknown option: $1" >&2
            exit 1
            ;;
    esac
done

# Update Gradle maxConnections based on throttle setting
GRADLE_PROPS_FILE="$HOME/.gradle/gradle.properties"
MAX_CONC="${PROXY_MAX_CONCURRENT:-3}"

if [ "$MAX_CONC" != "0" ] && [ -f "$GRADLE_PROPS_FILE" ]; then
    GRADLE_MAX_CONN=$((MAX_CONC - 1))
    # Ensure at least 1 connection
    [ "$GRADLE_MAX_CONN" -lt 1 ] && GRADLE_MAX_CONN=1

    PROP_NAME="systemProp.org.gradle.internal.http.maxConnections"

    if grep -q "^${PROP_NAME}=" "$GRADLE_PROPS_FILE" 2>/dev/null; then
        # Update existing value
        sed -i.bak "s/^${PROP_NAME}=.*/${PROP_NAME}=${GRADLE_MAX_CONN}/" "$GRADLE_PROPS_FILE"
        rm -f "${GRADLE_PROPS_FILE}.bak"
    else
        # Add new property
        echo "${PROP_NAME}=${GRADLE_MAX_CONN}" >> "$GRADLE_PROPS_FILE"
    fi
    echo "[gradle-proxy] Set Gradle maxConnections=${GRADLE_MAX_CONN}"
fi

# Set static Gradle properties for proxy environment
if [ -f "$GRADLE_PROPS_FILE" ]; then
    # Disable parallel builds
    PROP_PARALLEL="org.gradle.parallel"
    if grep -q "^${PROP_PARALLEL}=" "$GRADLE_PROPS_FILE" 2>/dev/null; then
        sed -i.bak "s/^${PROP_PARALLEL}=.*/${PROP_PARALLEL}=false/" "$GRADLE_PROPS_FILE"
        rm -f "${GRADLE_PROPS_FILE}.bak"
    else
        echo "${PROP_PARALLEL}=false" >> "$GRADLE_PROPS_FILE"
    fi

    # Limit worker threads
    PROP_WORKERS="org.gradle.workers.max"
    if grep -q "^${PROP_WORKERS}=" "$GRADLE_PROPS_FILE" 2>/dev/null; then
        sed -i.bak "s/^${PROP_WORKERS}=.*/${PROP_WORKERS}=1/" "$GRADLE_PROPS_FILE"
        rm -f "${GRADLE_PROPS_FILE}.bak"
    else
        echo "${PROP_WORKERS}=1" >> "$GRADLE_PROPS_FILE"
    fi

    echo "[gradle-proxy] Set Gradle parallel=false, workers.max=1"
fi

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
    echo "[gradle-proxy] ERROR: Bun not found" >&2
    exit 1
fi

# Check environment
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
    echo "[gradle-proxy] Not in Claude Code remote environment (CLAUDE_CODE_REMOTE != true) - skipping"
    exit 0
fi

# Start proxy in background
# Default is now 3 concurrent, show throttle status
MAX_CONC="${PROXY_MAX_CONCURRENT:-3}"
if [ "$MAX_CONC" = "0" ]; then
    THROTTLE_INFO=" (throttling disabled)"
else
    THROTTLE_INFO=" (max ${MAX_CONC} concurrent)"
fi
echo "[gradle-proxy] Starting proxy on localhost:${PROXY_LOCAL_PORT:-8899}...${THROTTLE_INFO}"
cd "$PROJECT_DIR"
nohup bun run src/proxy.ts > "$LOG_FILE" 2>&1 &
PROXY_PID=$!

# Save PID
echo "$PROXY_PID" > "$PID_FILE"

# Wait and verify startup (with timeout)
STARTUP_TIMEOUT=5
for i in $(seq 1 $STARTUP_TIMEOUT); do
    if kill -0 "$PROXY_PID" 2>/dev/null; then
        # Process is running, check if it's actually listening
        if [ "$i" -ge 2 ]; then
            echo "[gradle-proxy] Started (PID $PROXY_PID)"
            echo "[gradle-proxy] Logs: $LOG_FILE"
            exit 0
        fi
    else
        echo "[gradle-proxy] ERROR: Failed to start - check $LOG_FILE" >&2
        rm -f "$PID_FILE"
        exit 1
    fi
    sleep 1
done

# Final check
if kill -0 "$PROXY_PID" 2>/dev/null; then
    echo "[gradle-proxy] Started (PID $PROXY_PID)"
    echo "[gradle-proxy] Logs: $LOG_FILE"
else
    echo "[gradle-proxy] ERROR: Failed to start - check $LOG_FILE" >&2
    rm -f "$PID_FILE"
    exit 1
fi
