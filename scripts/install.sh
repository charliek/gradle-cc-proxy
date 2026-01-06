#!/usr/bin/env bash
#
# One-time installation script for gradle-cc-proxy.
# Run this once in your Claude Code environment.
#

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
GRADLE_PROPS_DIR="$HOME/.gradle"
GRADLE_PROPS_FILE="$GRADLE_PROPS_DIR/gradle.properties"

echo "=== Gradle Proxy Adapter Installation ==="
echo ""

# Check if we're in Claude Code environment
if [[ -z "$HTTP_PROXY" ]] && [[ -z "$HTTPS_PROXY" ]]; then
    echo "Warning: No HTTP_PROXY or HTTPS_PROXY environment variable found."
    echo "This tool is designed for the Claude Code environment."
    echo ""
fi

# Check for Bun
if ! command -v bun &> /dev/null; then
    echo "Error: Bun is not installed."
    echo "Please install Bun first: https://bun.sh"
    exit 1
fi

echo "Bun found: $(bun --version)"
echo ""

# Install dependencies
echo "Installing dependencies..."
cd "$PROJECT_DIR"
bun install
echo ""

# Create .gradle directory if it doesn't exist
mkdir -p "$GRADLE_PROPS_DIR"

# Configure Gradle proxy settings
echo "Configuring Gradle proxy settings..."

# Backup existing file if it exists
if [[ -f "$GRADLE_PROPS_FILE" ]]; then
    cp "$GRADLE_PROPS_FILE" "${GRADLE_PROPS_FILE}.backup"
    echo "Backed up existing gradle.properties to gradle.properties.backup"
fi

# Check if proxy settings already exist
if grep -q "systemProp.http.proxyHost=localhost" "$GRADLE_PROPS_FILE" 2>/dev/null; then
    echo "Gradle proxy settings already configured."
else
    # Append proxy settings
    cat >> "$GRADLE_PROPS_FILE" << 'EOF'

# Gradle Proxy Adapter settings (added by gradle-cc-proxy)
systemProp.http.proxyHost=localhost
systemProp.http.proxyPort=8899
systemProp.https.proxyHost=localhost
systemProp.https.proxyPort=8899
systemProp.http.nonProxyHosts=localhost|127.0.0.1
EOF
    echo "Added proxy settings to $GRADLE_PROPS_FILE"
fi

echo ""
echo "=== Installation Complete ==="
echo ""
echo "To start the proxy:"
echo "  $SCRIPT_DIR/start-proxy.sh"
echo ""
echo "To verify everything works:"
echo "  $SCRIPT_DIR/verify.sh"
echo ""
echo "Add this to your Claude Code startup hook:"
echo "  $SCRIPT_DIR/start-proxy.sh"
echo ""
