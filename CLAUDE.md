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
./scripts/install.sh   # Configure ~/.gradle/gradle.properties
./scripts/verify.sh    # Run test Gradle build
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

The proxy only runs when it detects the Claude Code environment by checking if `HTTP_PROXY` or `HTTPS_PROXY` contains the known proxy host `21.0.0.93`.

### Configuration via Environment Variables

- `HTTP_PROXY` / `HTTPS_PROXY` - Upstream proxy URL with JWT (format: `http://user:jwt@host:port`)
- `PROXY_LOCAL_PORT` - Local proxy port (default: 8899)
- `VERBOSE` - Enable verbose logging (true/1)
