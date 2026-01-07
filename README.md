# gradle-cc-proxy

Local HTTP proxy adapter that enables Gradle builds in the Claude Code remote environment by handling JWT proxy authentication.

## The Problem

Gradle uses Java's `HttpURLConnection` for network operations, which cannot properly handle JWT-based proxy authentication. This causes builds to fail with:

```
java.io.IOException: Unable to tunnel through proxy.
Proxy returns "HTTP/1.1 401 Unauthorized"
```

Tools like `curl` and `wget` work fine because they use different HTTP clients.

## The Solution

This proxy acts as a translation layer:

```
Gradle (no auth) → Local Proxy (localhost:8899) → JWT Auth → Upstream Proxy → Internet
```

Gradle connects to localhost without authentication. This proxy adds the JWT token and forwards to the upstream proxy.

## Installation

### Prerequisites

- [Bun](https://bun.sh) runtime
- Gradle (for verification)

### One-Time Setup

```bash
# Clone to a local directory
cd ~/.local
git clone <repo-url> gradle-cc-proxy
cd gradle-cc-proxy

# Run installation script
./scripts/install.sh
```

This will:
1. Install Bun dependencies
2. Configure `~/.gradle/gradle.properties` with proxy settings

### Starting the Proxy

```bash
# Start in background (for hooks) - uses default throttling (max 3 concurrent)
./scripts/start-proxy.sh

# Start with custom throttle limit
./scripts/start-proxy.sh --max-concurrent 5

# Disable throttling entirely
./scripts/start-proxy.sh --no-throttle

# Start with verbose logging
./scripts/start-proxy.sh --verbose

# Or run in foreground with verbose output
VERBOSE=true bun run src/proxy.ts
```

### Verification

```bash
./scripts/verify.sh
```

This runs a test Gradle build to confirm everything works.

## Usage

### With Claude Code Startup Hook

The recommended way to use gradle-cc-proxy is to install it once with `./scripts/install.sh`, then configure your project's session hook to:

1. Set environment variables to route traffic through localhost:8899
2. Start the proxy adapter in the background

Add this to your project's `.claude/hooks/claude-remote-session-hook.sh`:

```bash
# Set environment variables to use local proxy for Gradle wrapper
# Save the original upstream proxy for the proxy adapter to use
export UPSTREAM_HTTP_PROXY="${HTTP_PROXY:-${GLOBAL_AGENT_HTTP_PROXY:-}}"
export UPSTREAM_HTTPS_PROXY="${HTTPS_PROXY:-${GLOBAL_AGENT_HTTPS_PROXY:-}}"

# Point environment to local proxy adapter for Gradle
export http_proxy="http://localhost:8899"
export https_proxy="http://localhost:8899"
export HTTP_PROXY="http://localhost:8899"
export HTTPS_PROXY="http://localhost:8899"

# Start gradle-cc-proxy if installed
if [ -x "$HOME/.local/gradle-cc-proxy/scripts/start-proxy.sh" ]; then
    "$HOME/.local/gradle-cc-proxy/scripts/start-proxy.sh"
fi
```

The proxy adapter reads from `UPSTREAM_HTTP_PROXY` or `GLOBAL_AGENT_HTTP_PROXY` to get the upstream proxy URL with JWT token, while Gradle uses the local proxy on port 8899.

For a complete guide on setting up Claude Code remote environments for JVM/Gradle projects, including session hooks and this proxy, see:

**[Claude Code Remote Setup Guide](docs/claude-remote-setup-guide.md)**

### Manual Usage

```bash
# Terminal 1: Start proxy
cd ~/.local/gradle-cc-proxy
bun run src/proxy.ts

# Terminal 2: Run Gradle
cd ~/your-project
./gradlew build
```

## Configuration

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `CLAUDE_CODE_REMOTE` | Must be `true` for proxy to run | Required |
| `UPSTREAM_HTTP_PROXY` | Upstream proxy URL with JWT (checked first) | - |
| `UPSTREAM_HTTPS_PROXY` | Alternative to UPSTREAM_HTTP_PROXY | - |
| `GLOBAL_AGENT_HTTP_PROXY` | Claude Code upstream proxy (fallback) | - |
| `GLOBAL_AGENT_HTTPS_PROXY` | Claude Code upstream proxy (fallback) | - |
| `HTTP_PROXY` | Standard proxy variable (lowest priority) | - |
| `HTTPS_PROXY` | Standard proxy variable (lowest priority) | - |
| `PROXY_LOCAL_PORT` | Local proxy port | 8899 |
| `PROXY_MAX_CONCURRENT` | Max concurrent connections (0=unlimited) | 3 |
| `VERBOSE` | Enable verbose logging | false |

The proxy checks for upstream proxy configuration in this order:
1. `UPSTREAM_HTTP_PROXY` / `UPSTREAM_HTTPS_PROXY` (set by session hook)
2. `GLOBAL_AGENT_HTTP_PROXY` / `GLOBAL_AGENT_HTTPS_PROXY` (Claude Code environment)
3. `HTTP_PROXY` / `HTTPS_PROXY` (standard variables)

### Gradle Properties

The install script adds these to `~/.gradle/gradle.properties`:

```properties
systemProp.http.proxyHost=localhost
systemProp.http.proxyPort=8899
systemProp.https.proxyHost=localhost
systemProp.https.proxyPort=8899
systemProp.http.nonProxyHosts=localhost|127.0.0.1
```

## How It Works

### HTTPS Tunneling (CONNECT)

For HTTPS requests, Gradle sends a `CONNECT` request:

1. Gradle → `CONNECT plugins.gradle.org:443` → Local Proxy
2. Local Proxy → `CONNECT + Proxy-Authorization: Bearer <jwt>` → Upstream Proxy
3. Upstream Proxy → `200 Connection Established` → Local Proxy
4. Local Proxy → `200 Connection Established` → Gradle
5. Bidirectional TCP pipe established

### HTTP Forwarding

For plain HTTP requests, the proxy forwards with the JWT header added.

## Troubleshooting

### Proxy Not Starting

Check the log file:
```bash
cat ~/.local/gradle-cc-proxy/proxy.log
```

### Still Getting 401 Errors

1. Verify environment is set correctly:
   ```bash
   echo $CLAUDE_CODE_REMOTE
   # Should be: true
   echo $HTTP_PROXY
   # Should be: http://user:jwt_<token>@<proxy-host>:<port>
   # The proxy automatically strips the 'jwt_' prefix
   ```

2. Check proxy is running:
   ```bash
   cat ~/.local/gradle-cc-proxy/proxy.pid
   ps aux | grep proxy
   ```

3. Verify Gradle properties:
   ```bash
   cat ~/.gradle/gradle.properties | grep proxy
   ```

### Getting 503 Service Unavailable Errors

503 errors can occur due to rate limiting by the upstream proxy when too many connections are made simultaneously. The proxy includes built-in connection throttling (default: 3 concurrent connections) to mitigate this issue.

**Connection Throttling** (enabled by default):
- The proxy queues excess connections and processes them sequentially
- Default limit is 3 concurrent connections, which has been tested to achieve 100% success rate
- Queued requests typically wait 100-300ms before being processed

To adjust throttling:
```bash
# Use default throttling (recommended)
./scripts/start-proxy.sh

# Increase concurrent connections if needed
./scripts/start-proxy.sh --max-concurrent 5

# Disable throttling (not recommended - may cause 503 errors)
./scripts/start-proxy.sh --no-throttle
```

To verify the proxy is working:
1. Check proxy logs for "✓" tunnel establishment messages
2. Look for "[throttle]" log entries showing queued requests
3. Check `~/.gradle/caches` for successfully downloaded JARs

### Missing Gradle Wrapper JAR

If you see errors about missing `gradle-wrapper.jar`:

1. **Using system Gradle**: If you have Gradle installed globally, use `gradle wrapper` to generate the wrapper files
2. **No Gradle installed**: Download the wrapper files from a working project or use the Gradle wrapper from this repository's test-build directory
3. **Verification**: Check that `gradle/wrapper/gradle-wrapper.jar` exists in your project

```bash
# Generate wrapper if you have Gradle installed
gradle wrapper

# Or copy from test-build
cp test-build/gradle/wrapper/gradle-wrapper.jar your-project/gradle/wrapper/
```

### Connection Timeouts

The upstream proxy might be unreachable. Test with curl:
```bash
curl -v -x http://localhost:8899 https://plugins.gradle.org/
```

### Java Environment Issues

If Gradle is using the wrong Java version:

```bash
# Check current Java version
java -version

# Check JAVA_HOME
echo $JAVA_HOME

# Verify Java toolchain
cd test-build && ./gradlew -version
```

The Claude Code remote environment uses the system-provided OpenJDK. If you need a different Java version, you can install it manually or modify the container image.

## Security

- Binds only to `127.0.0.1` (never exposed on network)
- JWT tokens are never logged in full
- Only runs when Claude Code environment is detected

## Project Structure

```
gradle-cc-proxy/
├── src/
│   ├── proxy.ts           # Main proxy server
│   ├── config.ts          # Configuration loading
│   ├── auth.ts            # JWT authentication
│   ├── tunnel.ts          # CONNECT tunneling
│   ├── throttle.ts        # Connection throttling
│   └── __tests__/         # Unit tests
│       ├── config.test.ts
│       ├── auth.test.ts
│       ├── tunnel.test.ts
│       └── throttle.test.ts
├── scripts/
│   ├── install.sh         # One-time setup
│   ├── start-proxy.sh     # Background startup
│   ├── stop-proxy.sh      # Stop the proxy
│   └── verify.sh          # Verification test
├── .claude/
│   ├── settings.json      # Claude Code configuration
│   └── hooks/
│       └── claude-remote-session-hook.sh  # Session startup script
├── docs/
│   └── claude-remote-setup-guide.md  # Setup guide for JVM projects
├── test-build/            # Test Gradle project
│   ├── build.gradle.kts
│   └── settings.gradle.kts
├── .github/workflows/
│   └── ci.yml             # GitHub Actions CI
├── package.json
├── biome.json             # Linting & formatting config
└── README.md
```

## Development

### Prerequisites

- [Bun](https://bun.sh) v1.0+

### Setup

```bash
# Install dependencies
bun install

# Run tests
bun test

# Run tests in watch mode
bun test --watch

# Type check
bun run typecheck

# Lint
bun run lint

# Lint and fix
bun run lint:fix

# Format code
bun run format

# Run all CI checks
bun run ci
```

### Running Locally

```bash
# Set up environment for testing
export CLAUDE_CODE_REMOTE="true"
export HTTP_PROXY="http://user:fake-jwt-token-for-testing-purposes-only@proxy.example.com:15004"

# Run with verbose logging
VERBOSE=true bun run src/proxy.ts
```

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Make your changes
4. Run tests and linting (`bun run ci`)
5. Commit your changes
6. Push to the branch (`git push origin feature/amazing-feature`)
7. Open a Pull Request

### Code Style

This project uses [Biome](https://biomejs.dev/) for linting and formatting. Run `bun run lint:fix` before committing.

## License

MIT
