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
# Start in background (for hooks)
./scripts/start-proxy.sh

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

Add to your project's startup hook:

```bash
~/.local/gradle-cc-proxy/scripts/start-proxy.sh
```

The proxy starts in the background and all Gradle builds will use it automatically via `~/.gradle/gradle.properties`.

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
| `HTTP_PROXY` | Upstream proxy URL with JWT | Required |
| `HTTPS_PROXY` | Alternative to HTTP_PROXY | - |
| `PROXY_LOCAL_PORT` | Local proxy port | 8899 |
| `VERBOSE` | Enable verbose logging | false |

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

1. Verify HTTP_PROXY is set correctly:
   ```bash
   echo $HTTP_PROXY
   # Should be: http://user:jwt_<token>@21.0.0.93:15004 or @21.0.0.107:15004
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

External Maven repositories (plugins.gradle.org, repo.maven.apache.org) may occasionally return 503 errors due to rate limiting or temporary unavailability. This is not a proxy issue. The proxy logs will show successful tunnel establishment even when the remote server returns 503.

To verify the proxy is working:
1. Check proxy logs for "Tunnel established" messages
2. Check `~/.gradle/caches` for successfully downloaded JARs
3. Retry the build after a brief wait

### Connection Timeouts

The upstream proxy might be unreachable. Test with curl:
```bash
curl -v -x http://localhost:8899 https://plugins.gradle.org/
```

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
│   └── __tests__/         # Unit tests
│       ├── config.test.ts
│       ├── auth.test.ts
│       └── tunnel.test.ts
├── scripts/
│   ├── install.sh         # One-time setup
│   ├── start-proxy.sh     # Background startup
│   ├── stop-proxy.sh      # Stop the proxy
│   └── verify.sh          # Verification test
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
# Set up a mock proxy URL for testing
export HTTP_PROXY="http://user:fake-jwt-token-for-testing-purposes-only@21.0.0.93:15004"

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
