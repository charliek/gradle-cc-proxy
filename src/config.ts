/**
 * Configuration management for the Gradle proxy adapter.
 */

export interface ProxyConfig {
  /** Port the local proxy listens on */
  localPort: number;
  /** Upstream proxy host (extracted from HTTP_PROXY) */
  upstreamHost: string;
  /** Upstream proxy port */
  upstreamPort: number;
  /** JWT token for upstream authentication */
  jwtToken: string;
  /** Enable verbose logging */
  verbose: boolean;
  /** Maximum concurrent connections (default: 3, 0 = unlimited/disabled) */
  maxConcurrent: number;
}

/**
 * Check if we're running in the Claude Code environment.
 */
export function isClaudeCodeEnvironment(): boolean {
  return process.env.CLAUDE_CODE_REMOTE === "true";
}

/**
 * Parse a proxy URL to extract host, port, and credentials.
 * Format: http://username:password@host:port
 */
export function parseProxyUrl(proxyUrl: string): {
  host: string;
  port: number;
  username?: string;
  password?: string;
} | null {
  try {
    const url = new URL(proxyUrl);
    return {
      host: url.hostname,
      port: Number.parseInt(url.port, 10) || (url.protocol === "https:" ? 443 : 80),
      username: url.username || undefined,
      password: url.password ? decodeURIComponent(url.password) : undefined,
    };
  } catch {
    return null;
  }
}

/**
 * Check if a proxy URL points to localhost (potential circular reference).
 */
export function isLocalhostProxy(proxyUrl: string, localPort: number): boolean {
  const parsed = parseProxyUrl(proxyUrl);
  if (!parsed) return false;

  const isLocalhost =
    parsed.host === "localhost" ||
    parsed.host === "127.0.0.1" ||
    parsed.host === "::1" ||
    parsed.host === "[::1]";

  return isLocalhost && parsed.port === localPort;
}

/**
 * Find the upstream proxy URL from environment variables.
 * Returns the URL and the source variable name for diagnostics.
 */
export function findUpstreamProxy(localPort: number): { url: string; source: string } | null {
  // Priority order for finding upstream proxy
  // 1. UPSTREAM_* variables (explicitly set by session hook)
  // 2. GLOBAL_AGENT_* variables (Claude Code's internal proxy config)
  // 3. HTTP_PROXY/HTTPS_PROXY (standard proxy environment variables)
  const candidates: Array<{ name: string; value: string | undefined }> = [
    { name: "UPSTREAM_HTTP_PROXY", value: process.env.UPSTREAM_HTTP_PROXY },
    { name: "UPSTREAM_HTTPS_PROXY", value: process.env.UPSTREAM_HTTPS_PROXY },
    { name: "GLOBAL_AGENT_HTTP_PROXY", value: process.env.GLOBAL_AGENT_HTTP_PROXY },
    { name: "GLOBAL_AGENT_HTTPS_PROXY", value: process.env.GLOBAL_AGENT_HTTPS_PROXY },
    { name: "HTTP_PROXY", value: process.env.HTTP_PROXY },
    { name: "http_proxy", value: process.env.http_proxy },
    { name: "HTTPS_PROXY", value: process.env.HTTPS_PROXY },
    { name: "https_proxy", value: process.env.https_proxy },
  ];

  for (const candidate of candidates) {
    if (candidate.value) {
      // Skip if this would create a circular proxy reference
      if (isLocalhostProxy(candidate.value, localPort)) {
        console.warn(
          `[config] Skipping ${candidate.name} (points to localhost:${localPort}, would cause loop)`
        );
        continue;
      }
      return { url: candidate.value, source: candidate.name };
    }
  }

  return null;
}

/**
 * Load configuration from environment variables.
 */
export function loadConfig(): ProxyConfig {
  const localPort = Number.parseInt(process.env.PROXY_LOCAL_PORT || "8899", 10);

  // Find upstream proxy, avoiding circular references
  const upstream = findUpstreamProxy(localPort);

  if (!upstream) {
    throw new Error(
      "No valid upstream proxy found. Expected UPSTREAM_HTTP_PROXY, GLOBAL_AGENT_HTTP_PROXY, or HTTP_PROXY to be set with a non-localhost URL."
    );
  }

  // Log which source we're using (helpful for debugging)
  console.log(`[config] Using upstream from ${upstream.source}`);

  const parsed = parseProxyUrl(upstream.url);
  if (!parsed) {
    throw new Error(`Failed to parse proxy URL from ${upstream.source}: ${upstream.url}`);
  }

  if (!parsed.password) {
    throw new Error(
      `No JWT token found in ${upstream.source}. Expected format: http://user:jwt@host:port`
    );
  }

  // Strip 'jwt_' prefix if present (Claude Code environment format)
  let jwtToken = parsed.password;
  if (jwtToken.startsWith("jwt_")) {
    jwtToken = jwtToken.substring(4);
  }

  // Validate token has reasonable length (JWTs are typically 100+ chars)
  if (jwtToken.length < 50) {
    console.warn(
      `[config] Warning: JWT token seems short (${jwtToken.length} chars). Expected 100+ for JWT.`
    );
  }

  // Validate JWT format
  if (!isValidJwtFormat(jwtToken)) {
    console.warn(
      "[config] Warning: Token does not match JWT format (expected: header.payload.signature)"
    );
  }

  // Parse max concurrent connections (default: 3, set to 0 to disable throttling)
  const maxConcurrent = Number.parseInt(process.env.PROXY_MAX_CONCURRENT || "3", 10);

  return {
    localPort,
    upstreamHost: parsed.host,
    upstreamPort: parsed.port,
    jwtToken: jwtToken,
    verbose: process.env.VERBOSE === "true" || process.env.VERBOSE === "1",
    maxConcurrent: maxConcurrent >= 0 ? maxConcurrent : 0,
  };
}

/**
 * Validate JWT token format.
 * JWTs should have three base64-encoded parts separated by dots.
 */
export function isValidJwtFormat(token: string): boolean {
  // JWT format: header.payload.signature
  const parts = token.split(".");
  if (parts.length !== 3) {
    return false;
  }

  // Each part should be non-empty and base64-like (alphanumeric, -, _)
  const base64Pattern = /^[A-Za-z0-9_-]+$/;
  return parts.every((part) => part.length > 0 && base64Pattern.test(part));
}

/**
 * Sanitize JWT token for logging (show first 20 chars only).
 */
export function sanitizeToken(token: string): string {
  if (token.length <= 20) {
    return "***";
  }
  return `${token.substring(0, 20)}...`;
}
