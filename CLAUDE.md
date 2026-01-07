# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a local HTTP proxy adapter that enables Gradle builds in JWT-authenticated proxy environments (specifically Claude Code's remote environment). Gradle's Java HttpURLConnection cannot handle JWT proxy authentication, so this proxy acts as a translation layer: Gradle connects to localhost without auth, and this proxy adds the JWT token before forwarding to the upstream proxy.

## Commands

```bash
# Install dependencies
bun install

# Run the proxy server
bun run src/proxy.ts
VERBOSE=true bun run src/proxy.ts  # With verbose logging

# Run tests
bun test
bun test --watch

# Type check
bun run typecheck

# Lint
bun run lint
bun run lint:fix

# Format
bun run format

# Run all CI checks (typecheck + lint + test)
bun run ci

# Installation and verification scripts
./scripts/install.sh       # Configure ~/.gradle/gradle.properties
./scripts/verify.sh        # Run test Gradle build
```

## Architecture

The proxy runs on localhost:8899 (configurable via `PROXY_LOCAL_PORT`) and handles two types of traffic:

1. **HTTPS Tunneling (CONNECT)** - Most Gradle traffic uses this. The proxy receives a CONNECT request from Gradle, opens a connection to the upstream proxy with JWT auth, and establishes a bidirectional TCP pipe.

2. **HTTP Forwarding** - For rare plain HTTP requests, the proxy forwards with the JWT `Proxy-Authorization: Bearer` header added.

### Key Modules

- `src/proxy.ts` - Main server entry point, request routing
- `src/config.ts` - Configuration from environment variables, proxy URL parsing
- `src/auth.ts` - JWT Bearer token header construction
- `src/tunnel.ts` - CONNECT tunneling implementation with bidirectional piping

### Environment Detection

The proxy only runs when the `CLAUDE_CODE_REMOTE` environment variable is set to `"true"`.

### JWT Token Handling

The proxy automatically strips the `jwt_` prefix from tokens in the environment variable (format: `http://user:jwt_<token>@host:port`) before using them in Bearer authentication headers.

### Configuration via Environment Variables

- `HTTP_PROXY` / `HTTPS_PROXY` - Upstream proxy URL with JWT (format: `http://user:jwt_<token>@host:port`)
- `PROXY_LOCAL_PORT` - Local proxy port (default: 8899)
- `VERBOSE` - Enable verbose logging (true/1)

## Remote Environment Testing

This project is the gradle-cc-proxy itself - we're developing and testing the proxy, not just using it. The session hook only sets up the development environment; Claude manages proxy lifecycle and testing during coding sessions for better visibility.

### Testing Workflow

When working in the Claude Code remote environment:

1. **Start the proxy** (when ready to test Gradle integration):
   ```bash
   ./scripts/start-proxy.sh
   ```

2. **Run unit tests** (no proxy needed):
   ```bash
   bun test
   ```

3. **Run full CI checks**:
   ```bash
   bun run ci
   ```

4. **Verify Gradle integration** (requires proxy running):
   ```bash
   ./scripts/verify.sh
   ```
   This runs a real Gradle build in `test-build/` through the proxy.

5. **Stop the proxy** (when done testing):
   ```bash
   ./scripts/stop-proxy.sh
   ```

6. **Check proxy logs** (for debugging):
   ```bash
   cat proxy.log
   ```

### Key Difference from Consumer Projects

Consumer projects using gradle-cc-proxy will have their session hooks automatically start the proxy. This project intentionally does NOT auto-start the proxy because:
- We need visibility into proxy behavior during development
- We may be testing changes that require proxy restarts
- The verify script handles starting the proxy when needed
