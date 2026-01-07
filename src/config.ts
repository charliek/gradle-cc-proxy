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
 * Load configuration from environment variables.
 */
export function loadConfig(): ProxyConfig {
  // Check for upstream proxy first (set by session hook when HTTP_PROXY points to localhost)
  // Then fall back to GLOBAL_AGENT variables or regular proxy environment variables
  const httpProxy =
    process.env.UPSTREAM_HTTP_PROXY ||
    process.env.UPSTREAM_HTTPS_PROXY ||
    process.env.GLOBAL_AGENT_HTTP_PROXY ||
    process.env.GLOBAL_AGENT_HTTPS_PROXY ||
    process.env.HTTP_PROXY ||
    process.env.http_proxy ||
    process.env.HTTPS_PROXY ||
    process.env.https_proxy;

  if (!httpProxy) {
    throw new Error("No proxy environment variable found. Set HTTP_PROXY or HTTPS_PROXY.");
  }

  const parsed = parseProxyUrl(httpProxy);
  if (!parsed) {
    throw new Error(`Failed to parse proxy URL: ${httpProxy}`);
  }

  if (!parsed.password) {
    throw new Error("No JWT token found in proxy URL. Expected format: http://user:jwt@host:port");
  }

  // Strip 'jwt_' prefix if present (Claude Code environment format)
  let jwtToken = parsed.password;
  if (jwtToken.startsWith("jwt_")) {
    jwtToken = jwtToken.substring(4);
  }

  // Validate token has reasonable length (JWTs are typically 100+ chars)
  if (jwtToken.length < 50) {
    console.warn(
      `Warning: JWT token seems short (${jwtToken.length} chars). Expected 100+ for JWT.`
    );
  }

  // Validate JWT format
  if (!isValidJwtFormat(jwtToken)) {
    console.warn("Warning: Token does not match JWT format (expected: header.payload.signature)");
  }

  return {
    localPort: Number.parseInt(process.env.PROXY_LOCAL_PORT || "8899", 10),
    upstreamHost: parsed.host,
    upstreamPort: parsed.port,
    jwtToken: jwtToken,
    verbose: process.env.VERBOSE === "true" || process.env.VERBOSE === "1",
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
