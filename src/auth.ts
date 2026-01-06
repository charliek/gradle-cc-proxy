/**
 * JWT authentication handling for upstream proxy.
 */

import { sanitizeToken } from "./config";

/**
 * Build the Proxy-Authorization header value for JWT authentication.
 * Uses Bearer token format.
 */
export function buildProxyAuthHeader(jwtToken: string): string {
  return `Bearer ${jwtToken}`;
}

/**
 * Build the full CONNECT request to send to upstream proxy.
 */
export function buildConnectRequest(
  targetHost: string,
  targetPort: number,
  jwtToken: string
): string {
  const authHeader = buildProxyAuthHeader(jwtToken);
  return [
    `CONNECT ${targetHost}:${targetPort} HTTP/1.1`,
    `Host: ${targetHost}:${targetPort}`,
    `Proxy-Authorization: ${authHeader}`,
    "Proxy-Connection: keep-alive",
    "",
    "",
  ].join("\r\n");
}

/**
 * Log an authentication attempt (sanitized).
 */
export function logAuthAttempt(
  targetHost: string,
  targetPort: number,
  jwtToken: string,
  verbose: boolean
): void {
  if (verbose) {
    console.log(
      `[auth] Authenticating to ${targetHost}:${targetPort} with token: ${sanitizeToken(jwtToken)}`
    );
  }
}
