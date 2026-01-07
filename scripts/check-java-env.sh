#!/bin/bash
#
# check-java-env.sh - Verify Java environment configuration
#
# This script verifies that the Java environment is properly configured
# for Gradle to use the correct JVM version.
#

set -e

echo "=== Java Environment Check ==="
echo

echo "1. JAVA_HOME:"
if [ -n "${JAVA_HOME:-}" ]; then
    echo "   ✓ JAVA_HOME is set: $JAVA_HOME"
else
    echo "   ✗ JAVA_HOME is not set"
fi
echo

echo "2. Java binary location:"
which java
echo

echo "3. Java version:"
java -version 2>&1 | head -3
echo

echo "4. Expected version from .sdkmanrc:"
if [ -f ".sdkmanrc" ]; then
    grep "^java=" .sdkmanrc || echo "   No java version specified in .sdkmanrc"
else
    echo "   .sdkmanrc not found"
fi
echo

echo "5. PATH (first 3 entries):"
echo "$PATH" | tr ':' '\n' | head -3
echo

if [ -n "${JAVA_HOME:-}" ]; then
    echo "✓ Java environment is configured"
    echo "  Gradle will use: $JAVA_HOME"
else
    echo "⚠ Warning: JAVA_HOME is not set"
    echo "  Gradle will use the Java from PATH: $(which java)"
fi
