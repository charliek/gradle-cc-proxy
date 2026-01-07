# Claude Code Remote Environment Setup Guide for JVM/Gradle Projects

This guide documents a pattern for setting up Claude Code remote environments for JVM/Gradle projects. It covers:

1. The two-file configuration pattern (settings.json + session hook)
2. Installing and configuring gradle-cc-proxy for Gradle builds
3. Managing JVM versions with SDKMAN
4. Best practices for timeouts and error handling

## Overview

Claude Code remote environments start fresh each session. To ensure a consistent development experience, we use:

1. **`.claude/settings.json`** - Declares environment variables and hooks
2. **`.claude/hooks/claude-remote-session-hook.sh`** - Bootstraps the environment on session start

The hook script is organized into two phases:
- **Phase 1: Core Development Tools** - Tools Claude needs (gh, bun, SDKMAN, Java)
- **Phase 2: Project Infrastructure** - Project-specific setup (dependencies, services, proxy)

## Quick Start

For a JVM/Gradle project, create these two files:

### `.claude/settings.json`

```json
{
  "hooks": {
    "SessionStart": [
      {
        "matcher": "*",
        "hooks": [
          {
            "type": "command",
            "command": "./.claude/hooks/claude-remote-session-hook.sh"
          }
        ]
      }
    ]
  },
  "env": {
    "PATH": "$HOME/.local/bin:$HOME/.bun/bin:$PATH",
    "BUN_VERSION": "1.3.4"
  }
}
```

### `.claude/hooks/claude-remote-session-hook.sh`

See the [Template Script](#template-session-hook-script) section below for a complete example.

### `.sdkmanrc`

```
java=21.0.9-amzn
```

## Installing gradle-cc-proxy

gradle-cc-proxy is required for Gradle builds in Claude Code's remote environment. Gradle cannot handle JWT proxy authentication natively, so this proxy acts as a translation layer.

### One-Time Installation

```bash
# Clone to ~/.local (recommended location)
cd ~/.local
git clone https://github.com/charliek/gradle-cc-proxy.git
cd gradle-cc-proxy

# Run installation
./scripts/install.sh
```

This configures `~/.gradle/gradle.properties` with proxy settings that route all Gradle traffic through localhost:8899.

### Starting the Proxy

Add this to your session hook's Phase 2:

```bash
# Start gradle-cc-proxy if installed
if [ -x "$HOME/.local/gradle-cc-proxy/scripts/start-proxy.sh" ]; then
    "$HOME/.local/gradle-cc-proxy/scripts/start-proxy.sh"
fi
```

## Template Session Hook Script

```bash
#!/bin/bash
# =============================================================================
# Claude Code Remote Environment Session Hook
# =============================================================================
#
# This script runs at the start of each Claude Code session in remote environments.
# Customize Phase 1 and Phase 2 for your project's needs.
#
# =============================================================================

set -euo pipefail

# Only run in Claude Code remote environments
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
    exit 0
fi

# Ensure standard system paths are in PATH
export PATH="$HOME/.local/bin:$HOME/.bun/bin:$HOME/.sdkman/candidates/java/current/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:$PATH"

# Store the project root
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

# =============================================================================
# PHASE 1: Core Development Tools
# =============================================================================

# -----------------------------------------------------------------------------
# GitHub CLI Setup
# -----------------------------------------------------------------------------
if ! command -v gh > /dev/null 2>&1 && [ ! -f "$HOME/.local/bin/gh" ]; then
    echo "Installing GitHub CLI..."
    GH_VERSION="2.63.2"
    GH_TARBALL="gh_${GH_VERSION}_linux_amd64.tar.gz"
    GH_URL="https://github.com/cli/cli/releases/download/v${GH_VERSION}/${GH_TARBALL}"

    cd /tmp
    if ! curl -fsSL --connect-timeout 10 --max-time 60 "$GH_URL" -o gh.tar.gz; then
        echo "ERROR: Failed to download GitHub CLI" >&2
        exit 1
    fi

    tar -xzf gh.tar.gz
    mkdir -p "$HOME/.local/bin"
    cp "gh_${GH_VERSION}_linux_amd64/bin/gh" "$HOME/.local/bin/"
    chmod +x "$HOME/.local/bin/gh"
    rm -rf gh.tar.gz "gh_${GH_VERSION}_linux_amd64"
    echo "GitHub CLI installed"
fi

# -----------------------------------------------------------------------------
# GitHub CLI Configuration (GH_REPO)
# -----------------------------------------------------------------------------
# Set default repository for gh commands so -R flag is not needed
# Change this to your repository
export GH_REPO="your-org/your-repo"

# -----------------------------------------------------------------------------
# Bun Setup (if needed for gradle-cc-proxy)
# -----------------------------------------------------------------------------
# The BUN_VERSION is set in .claude/settings.json

if command -v bun > /dev/null 2>&1 || [ -x "$HOME/.bun/bin/bun" ]; then
    # Bun is installed, check if we need to verify the version
    if [ -n "${BUN_VERSION:-}" ]; then
        CURRENT_BUN_VERSION=$(bun --version 2>/dev/null || echo "unknown")
        if [ "$CURRENT_BUN_VERSION" != "$BUN_VERSION" ]; then
            echo "WARNING: Bun $CURRENT_BUN_VERSION is installed, but $BUN_VERSION is specified" >&2
            echo "To update, run: curl -fsSL https://bun.sh/install | bash -s \"bun-v${BUN_VERSION}\"" >&2
        fi
    fi
else
    # Bun not installed, install it
    if [ -n "${BUN_VERSION:-}" ]; then
        echo "Installing Bun $BUN_VERSION..."
        if ! curl -fsSL --connect-timeout 10 --max-time 60 https://bun.sh/install 2>/dev/null | bash -s "bun-v${BUN_VERSION}" > /dev/null 2>&1; then
            echo "ERROR: Failed to install Bun $BUN_VERSION" >&2
            exit 1
        fi
    else
        echo "Installing Bun..."
        if ! curl -fsSL --connect-timeout 10 --max-time 60 https://bun.sh/install 2>/dev/null | bash > /dev/null 2>&1; then
            echo "ERROR: Failed to install Bun" >&2
            exit 1
        fi
    fi

    if [ -x "$HOME/.bun/bin/bun" ]; then
        echo "Bun installed"
    else
        echo "ERROR: Bun installation failed - binary not found" >&2
        exit 1
    fi
fi

# -----------------------------------------------------------------------------
# SDKMAN Setup
# -----------------------------------------------------------------------------
if [ ! -d "$HOME/.sdkman" ]; then
    echo "Installing SDKMAN..."
    curl -fsSL --connect-timeout 10 --max-time 60 "https://get.sdkman.io?rcupdate=false" | bash > /dev/null 2>&1
    echo "SDKMAN installed"
fi

# Source SDKMAN
# Note: SDKMAN's init script uses [ -z "$VAR" ] checks which fail under 'set -u'
# when variables are unset. We temporarily disable -u to allow initialization.
if [ -f "$HOME/.sdkman/bin/sdkman-init.sh" ]; then
    export SDKMAN_DIR="$HOME/.sdkman"
    set +u  # Temporarily allow unset variables for SDKMAN
    source "$HOME/.sdkman/bin/sdkman-init.sh"
    set -u  # Re-enable strict mode
fi

# -----------------------------------------------------------------------------
# Java Setup via SDKMAN
# -----------------------------------------------------------------------------
if [ -f "$PROJECT_ROOT/.sdkmanrc" ] && command -v sdk > /dev/null 2>&1; then
    JAVA_VERSION=$(grep "^java=" "$PROJECT_ROOT/.sdkmanrc" | cut -d'=' -f2)
    if [ -n "$JAVA_VERSION" ]; then
        set +u  # SDKMAN commands also use unset variable checks
        if ! sdk list java 2>/dev/null | grep -q "$JAVA_VERSION.*installed"; then
            echo "Installing Java $JAVA_VERSION..."
            timeout 120 sdk install java "$JAVA_VERSION" < /dev/null > /dev/null 2>&1 || true
        fi
        sdk use java "$JAVA_VERSION" < /dev/null > /dev/null 2>&1 || true
        sdk default java "$JAVA_VERSION" < /dev/null > /dev/null 2>&1 || true
        set -u  # Re-enable strict mode

        # Export JAVA_HOME for Gradle
        if [ -d "$HOME/.sdkman/candidates/java/current" ]; then
            export JAVA_HOME="$HOME/.sdkman/candidates/java/current"
            export PATH="$JAVA_HOME/bin:$PATH"
        fi
    fi
fi

# =============================================================================
# PHASE 2: Project Infrastructure
# =============================================================================

# -----------------------------------------------------------------------------
# gradle-cc-proxy Setup
# -----------------------------------------------------------------------------
# Install and start the Gradle proxy for JWT-authenticated environments

if [ ! -d "$HOME/.local/gradle-cc-proxy" ]; then
    echo "Installing gradle-cc-proxy..."
    cd "$HOME/.local"
    if git clone --depth 1 https://github.com/charliek/gradle-cc-proxy.git > /dev/null 2>&1; then
        cd gradle-cc-proxy
        if timeout 60 "$HOME/.local/gradle-cc-proxy/scripts/install.sh" > /dev/null 2>&1; then
            echo "gradle-cc-proxy installed"
        else
            echo "WARNING: gradle-cc-proxy installation failed" >&2
        fi
    else
        echo "WARNING: Failed to clone gradle-cc-proxy" >&2
    fi
fi

# Start the proxy
if [ -x "$HOME/.local/gradle-cc-proxy/scripts/start-proxy.sh" ]; then
    "$HOME/.local/gradle-cc-proxy/scripts/start-proxy.sh"
fi

# -----------------------------------------------------------------------------
# Project Dependencies
# -----------------------------------------------------------------------------
cd "$PROJECT_ROOT"

# Setup any project specific infra here

echo "Claude Code remote environment setup complete"
```

## Timeout Guidelines

All network operations should have timeouts to fail fast:

| Operation | Recommended Timeout |
|-----------|-------------------|
| curl downloads | `--connect-timeout 10 --max-time 60` |
| Package installs | `timeout 60 <command>` |
| SDK installs | `timeout 120 sdk install ...` |
| Service health checks | 5-10 seconds |

## SDKMAN + .sdkmanrc Pattern

SDKMAN provides reproducible JVM environments via `.sdkmanrc`:

```
# .sdkmanrc
java=21.0.9-amzn
```

The session hook reads this file and installs/activates the specified version.

Available distributions:
- `amzn` - Amazon Corretto
- `tem` - Eclipse Temurin
- `graal` - GraalVM
- `zulu` - Azul Zulu

Find versions with: `sdk list java`

## Gradle Wrapper Pattern

Always use the Gradle wrapper (`gradlew`) for reproducible builds:

```bash
# Generate wrapper (if not present)
gradle wrapper --gradle-version 8.14.3

# Build commands always use wrapper
./gradlew build
./gradlew test
```

The wrapper automatically downloads the correct Gradle version on first use.

## GH_REPO Configuration

Set `GH_REPO` to enable GitHub CLI commands without the `-R` flag:

```bash
export GH_REPO="your-org/your-repo"

# Now these work without -R:
gh pr list
gh issue create
gh pr create
```

Add this to your session hook after installing gh.

## Customization Examples

### Adding PostgreSQL

```bash
# In Phase 2
if command -v pg_ctlcluster > /dev/null 2>&1; then
    if ! pg_isready -q 2>/dev/null; then
        sudo pg_ctlcluster 16 main start > /dev/null 2>&1
        # Wait for ready
        for i in $(seq 1 10); do
            pg_isready -q 2>/dev/null && break
            sleep 1
        done
    fi
fi
```

### Adding Redis

```bash
# In Phase 2
if command -v redis-server > /dev/null 2>&1; then
    if ! redis-cli ping > /dev/null 2>&1; then
        redis-server --daemonize yes > /dev/null 2>&1
        for i in $(seq 1 5); do
            redis-cli ping > /dev/null 2>&1 && break
            sleep 1
        done
    fi
fi
```

### Python via uv

```bash
# In settings.json env section
"UV_PYTHON": "3.13"

# In Phase 1
if command -v uv > /dev/null 2>&1 && [ -n "${UV_PYTHON:-}" ]; then
    uv python install "$UV_PYTHON" > /dev/null 2>&1
fi
```

## Troubleshooting

### Proxy Not Working

1. Check if proxy is running:
   ```bash
   cat ~/.local/gradle-cc-proxy/proxy.pid
   ps aux | grep proxy
   ```

2. Check proxy logs:
   ```bash
   cat ~/.local/gradle-cc-proxy/proxy.log
   ```

3. Verify Gradle properties:
   ```bash
   cat ~/.gradle/gradle.properties | grep proxy
   ```

### SDKMAN "Unbound Variable" Error

If you see errors like `SDKMAN_CANDIDATES_API: unbound variable`, this is because
SDKMAN's scripts use `[ -z "$VAR" ]` checks which fail under bash's `set -u` option.

**Fix:** Temporarily disable `set -u` when sourcing SDKMAN:

```bash
set +u  # Temporarily allow unset variables
source "$HOME/.sdkman/bin/sdkman-init.sh"
set -u  # Re-enable strict mode
```

Also wrap SDKMAN commands (`sdk install`, `sdk use`, etc.) with `set +u`/`set -u`.

### SDKMAN Not Finding Java

1. Ensure SDKMAN is sourced:
   ```bash
   source "$HOME/.sdkman/bin/sdkman-init.sh"
   ```

2. Check available versions:
   ```bash
   sdk list java | grep installed
   ```

### Hook Not Running

1. Verify hook is executable:
   ```bash
   chmod +x .claude/hooks/claude-remote-session-hook.sh
   ```

2. Check settings.json syntax (must be valid JSON)

3. Test hook manually:
   ```bash
   CLAUDE_CODE_REMOTE=true ./.claude/hooks/claude-remote-session-hook.sh
   ```
