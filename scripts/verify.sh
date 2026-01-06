#!/usr/bin/env bash
#
# Verify the proxy is working by running a test Gradle build.
#

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
TEST_BUILD_DIR="$PROJECT_DIR/test-build"
PID_FILE="$PROJECT_DIR/proxy.pid"

echo "=== Gradle Proxy Verification ==="
echo ""

# Check if proxy is running
if [[ -f "$PID_FILE" ]]; then
    PID=$(cat "$PID_FILE")
    if kill -0 "$PID" 2>/dev/null; then
        echo "Proxy is running (PID $PID)"
    else
        echo "Proxy PID file exists but process not running."
        echo "Starting proxy..."
        "$SCRIPT_DIR/start-proxy.sh"
    fi
else
    echo "Proxy not running. Starting..."
    "$SCRIPT_DIR/start-proxy.sh"
fi

echo ""

# Wait a moment for proxy to be ready
sleep 2

# Check for Gradle
if ! command -v gradle &> /dev/null; then
    echo "Warning: Gradle not found in PATH"
    echo "Will use Gradle wrapper from test project"
fi

# Run test build
echo "Running test Gradle build..."
echo ""
cd "$TEST_BUILD_DIR"

# Clean any previous build
rm -rf build .gradle

# Determine which gradle to use
if command -v gradle &> /dev/null; then
    GRADLE_CMD="gradle"
else
    GRADLE_CMD="./gradlew"
    chmod +x gradlew
fi

echo "Using: $GRADLE_CMD"
echo ""

# Run the build
if $GRADLE_CMD build --no-daemon; then
    echo ""
    echo "=== Verification PASSED ==="
    echo ""
    echo "The Gradle proxy is working correctly!"
    echo "Dependencies were downloaded successfully."
    exit 0
else
    echo ""
    echo "=== Verification FAILED ==="
    echo ""
    echo "Check the proxy logs: $PROJECT_DIR/proxy.log"
    echo ""
    echo "Common issues:"
    echo "  - HTTP_PROXY environment variable not set correctly"
    echo "  - JWT token expired or invalid"
    echo "  - Upstream proxy not reachable"
    echo "  - External repository temporarily unavailable (503 errors)"
    exit 1
fi
