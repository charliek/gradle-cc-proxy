#!/bin/bash
# =============================================================================
# Claude Code Remote Environment Session Hook
# =============================================================================
#
# This script runs at the start of each Claude Code session in remote environments.
# It ensures the development environment is fully bootstrapped and ready to use.
#
# PROJECT: gradle-cc-proxy
# PURPOSE: This is the proxy project itself - we're developing/testing it, not
#          just using it. Therefore this hook only sets up the dev environment
#          and does NOT start the proxy or run tests. Claude manages those
#          during coding sessions for better visibility.
#
# TEMPLATE GUIDE:
# When adapting this script for other projects, it is organized into two phases:
#
#   PHASE 1: Core Development Tools
#   --------------------------------
#   Tools that Claude Code needs to work effectively in any project.
#   These are generally stable across projects and include:
#   - GitHub CLI (gh) - for PR/issue workflows
#   - Runtime tools (Bun, Node, Python, etc.) - as needed by the project
#   - SDKMAN + Java - for JVM projects
#   - Any other tools referenced in CLAUDE.md commands
#
#   PHASE 2: Project Dependencies
#   --------------------------------
#   Project-specific setup that mimics what a developer would do after cloning.
#   For this project: just bun install (no proxy start, no tests)
#
# TIMEOUT MANAGEMENT:
# All operations should have reasonable timeouts to fail fast rather than
# hang indefinitely. A stuck setup script is worse than a failed one.
# Guidelines:
#   - curl downloads: --connect-timeout 10 --max-time 60
#   - Package installs: timeout 60 <command>
#   - Prefer warnings over blocking when non-critical operations fail
#
# =============================================================================

set -euo pipefail

# Only run in Claude Code remote environments
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
    exit 0
fi

# Ensure standard system paths are in PATH (hooks may run with minimal environment)
export PATH="$HOME/.local/bin:$HOME/.bun/bin:$HOME/.sdkman/candidates/java/current/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:$PATH"

# Store the project root for navigation (must be done before any cd commands)
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

# =============================================================================
# PHASE 1: Core Development Tools
# =============================================================================
# These tools are required for Claude Code to work effectively.
# They should be installed before any project-specific setup.
# =============================================================================

# -----------------------------------------------------------------------------
# GitHub CLI Setup
# -----------------------------------------------------------------------------
# Required for: PR creation, issue management, repository operations
# The GH_TOKEN environment variable should be set in Claude Code settings

if ! command -v gh > /dev/null 2>&1 && [ ! -f "$HOME/.local/bin/gh" ]; then
    echo "Installing GitHub CLI..."
    GH_VERSION="2.63.2"
    GH_TARBALL="gh_${GH_VERSION}_linux_amd64.tar.gz"
    GH_URL="https://github.com/cli/cli/releases/download/v${GH_VERSION}/${GH_TARBALL}"

    cd /tmp
    if ! curl -fsSL --connect-timeout 10 --max-time 60 "$GH_URL" -o gh.tar.gz; then
        echo "ERROR: Failed to download GitHub CLI from $GH_URL" >&2
        echo "If running in a restricted environment, enable full network access or add github.com to your custom environment's allowed domains." >&2
        exit 1
    fi

    if ! tar -xzf gh.tar.gz; then
        echo "ERROR: Failed to extract GitHub CLI tarball" >&2
        rm -f gh.tar.gz
        exit 1
    fi

    mkdir -p "$HOME/.local/bin"
    if ! cp "gh_${GH_VERSION}_linux_amd64/bin/gh" "$HOME/.local/bin/"; then
        echo "ERROR: Failed to copy gh binary to ~/.local/bin/" >&2
        rm -rf gh.tar.gz "gh_${GH_VERSION}_linux_amd64"
        exit 1
    fi

    chmod +x "$HOME/.local/bin/gh"
    rm -rf gh.tar.gz "gh_${GH_VERSION}_linux_amd64"

    if [ -x "$HOME/.local/bin/gh" ]; then
        echo "GitHub CLI installed to ~/.local/bin/gh"
    else
        echo "ERROR: GitHub CLI installation failed - binary not executable" >&2
        exit 1
    fi
fi

# -----------------------------------------------------------------------------
# GitHub CLI Configuration
# -----------------------------------------------------------------------------
# Set default repository for gh commands so -R flag is not needed

export GH_REPO="charliek/gradle-cc-proxy"

# -----------------------------------------------------------------------------
# Bun Setup
# -----------------------------------------------------------------------------
# Required for: Running this project's build system, tests, and proxy
# The BUN_VERSION is set in .claude/settings.json

if command -v bun > /dev/null 2>&1 || [ -x "$HOME/.bun/bin/bun" ]; then
    # Bun is installed, check if we need to verify the version
    if [ -n "${BUN_VERSION:-}" ]; then
        CURRENT_BUN_VERSION=$(bun --version 2>/dev/null || echo "unknown")
        if [ "$CURRENT_BUN_VERSION" = "$BUN_VERSION" ]; then
            :
        else
            echo "WARNING: Bun $CURRENT_BUN_VERSION is installed, but $BUN_VERSION is specified in .claude/settings.json" >&2
            echo "To avoid disrupting your environment, the existing version will be used." >&2
            echo "To update, run: curl -fsSL https://bun.sh/install | bash -s \"bun-v${BUN_VERSION}\"" >&2
        fi
    fi
else
    # Bun not installed, install it
    if [ -n "${BUN_VERSION:-}" ]; then
        echo "Installing Bun $BUN_VERSION..."
        if ! curl -fsSL --connect-timeout 10 --max-time 60 https://bun.sh/install 2>/dev/null | bash -s "bun-v${BUN_VERSION}" > /dev/null 2>&1; then
            echo "ERROR: Failed to install Bun $BUN_VERSION" >&2
            echo "If running in a restricted environment, enable full network access or add bun.sh to your custom environment's allowed domains." >&2
            exit 1
        fi

        if [ -x "$HOME/.bun/bin/bun" ]; then
            echo "Bun $BUN_VERSION installed to ~/.bun/bin/bun"
        else
            echo "ERROR: Bun installation failed - binary not found" >&2
            exit 1
        fi
    else
        echo "Installing Bun..."
        if ! curl -fsSL --connect-timeout 10 --max-time 60 https://bun.sh/install 2>/dev/null | bash > /dev/null 2>&1; then
            echo "ERROR: Failed to install Bun" >&2
            echo "If running in a restricted environment, enable full network access or add bun.sh to your custom environment's allowed domains." >&2
            exit 1
        fi

        if [ -x "$HOME/.bun/bin/bun" ]; then
            echo "Bun installed to ~/.bun/bin/bun"
        else
            echo "ERROR: Bun installation failed - binary not found" >&2
            exit 1
        fi
    fi
fi

# -----------------------------------------------------------------------------
# SDKMAN Setup
# -----------------------------------------------------------------------------
# Required for: Managing Java versions via .sdkmanrc

if [ ! -d "$HOME/.sdkman" ]; then
    echo "Installing SDKMAN..."
    if ! curl -fsSL --connect-timeout 10 --max-time 60 "https://get.sdkman.io?rcupdate=false" | bash > /dev/null 2>&1; then
        echo "ERROR: Failed to install SDKMAN" >&2
        echo "If running in a restricted environment, enable full network access or add get.sdkman.io to your custom environment's allowed domains." >&2
        exit 1
    fi
    echo "SDKMAN installed"
fi

# Source SDKMAN
# Note: SDKMAN's init script checks variables like $SDKMAN_CANDIDATES_API with
# [ -z "$VAR" ] syntax, which fails under 'set -u' when unset. We temporarily
# disable -u to allow SDKMAN to initialize properly.
if [ -f "$HOME/.sdkman/bin/sdkman-init.sh" ]; then
    export SDKMAN_DIR="$HOME/.sdkman"
    set +u  # Temporarily allow unset variables (SDKMAN uses [ -z "$VAR" ] checks)
    # shellcheck source=/dev/null
    source "$HOME/.sdkman/bin/sdkman-init.sh"
    set -u  # Re-enable strict unset variable checking
fi

# -----------------------------------------------------------------------------
# Java Setup via SDKMAN
# -----------------------------------------------------------------------------
# Install Java version from .sdkmanrc if it exists

if [ -f "$PROJECT_ROOT/.sdkmanrc" ] && command -v sdk > /dev/null 2>&1; then
    # Read Java version from .sdkmanrc
    JAVA_VERSION=$(grep "^java=" "$PROJECT_ROOT/.sdkmanrc" | cut -d'=' -f2)
    if [ -n "$JAVA_VERSION" ]; then
        # Disable -u for SDKMAN commands (they use unset variable checks internally)
        set +u

        # Check if this version is already installed
        if ! sdk list java 2>/dev/null | grep -q "$JAVA_VERSION.*installed"; then
            echo "Installing Java $JAVA_VERSION via SDKMAN..."
            if ! timeout 120 sdk install java "$JAVA_VERSION" < /dev/null > /dev/null 2>&1; then
                echo "WARNING: Failed to install Java $JAVA_VERSION via SDKMAN" >&2
                echo "You may need to run 'sdk install java $JAVA_VERSION' manually" >&2
            else
                echo "Java $JAVA_VERSION installed"
            fi
        fi

        # Use the version and set as default
        sdk use java "$JAVA_VERSION" < /dev/null > /dev/null 2>&1 || true
        sdk default java "$JAVA_VERSION" < /dev/null > /dev/null 2>&1 || true

        set -u  # Re-enable strict mode

        # Export JAVA_HOME to ensure Gradle uses this Java version
        if [ -d "$HOME/.sdkman/candidates/java/current" ]; then
            export JAVA_HOME="$HOME/.sdkman/candidates/java/current"
            export PATH="$JAVA_HOME/bin:$PATH"
            echo "JAVA_HOME set to $JAVA_HOME"
        fi
    fi
fi

# =============================================================================
# PHASE 2: Project Dependencies
# =============================================================================
# This project is the gradle-cc-proxy itself. We only install dependencies here.
# Claude manages proxy start/stop and testing during coding sessions.
# =============================================================================

# -----------------------------------------------------------------------------
# Project Dependencies
# -----------------------------------------------------------------------------
# Install bun dependencies

if command -v bun > /dev/null 2>&1; then
    cd "$PROJECT_ROOT"

    # Only install if node_modules doesn't exist or lockfile changed
    if [ ! -d "node_modules" ] || [ "bun.lockb" -nt "node_modules" ]; then
        echo "Installing project dependencies..."
        if ! timeout 60 bun install > /dev/null 2>&1; then
            echo "WARNING: Failed to install dependencies" >&2
            echo "You may need to run 'bun install' manually" >&2
        else
            echo "Project dependencies installed"
        fi
    fi
fi

echo "Claude Code remote environment setup complete"
echo ""
echo "NOTE: This is the gradle-cc-proxy project itself."
echo "To test, use Claude to run: ./scripts/start-proxy.sh && ./scripts/verify.sh"
