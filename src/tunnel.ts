/**
 * CONNECT tunneling for HTTPS traffic.
 *
 * Flow:
 * 1. Client sends CONNECT host:443 to us
 * 2. We open TCP connection to upstream proxy
 * 3. We send CONNECT with JWT auth to upstream
 * 4. Upstream sends 200 Connection Established
 * 5. We send 200 back to client
 * 6. We pipe bytes bidirectionally (client <-> upstream)
 */

import { Socket } from "node:net";
import { buildConnectRequest, logAuthAttempt } from "./auth";
import type { ProxyConfig } from "./config";

/**
 * Handle a CONNECT request from the client.
 * @param clientSocket - The client's socket connection
 * @param targetHost - The target host to tunnel to
 * @param targetPort - The target port to tunnel to
 * @param config - Proxy configuration
 * @param head - Any data already read after the CONNECT headers
 */
export async function handleConnect(
  clientSocket: Socket,
  targetHost: string,
  targetPort: number,
  config: ProxyConfig,
  head?: Buffer
): Promise<void> {
  const { upstreamHost, upstreamPort, jwtToken, verbose } = config;

  // Always log CONNECT requests for debugging
  console.log(`[tunnel] CONNECT ${targetHost}:${targetPort}`);

  if (verbose) {
    logAuthAttempt(upstreamHost, upstreamPort, jwtToken, verbose);
  }

  // Connect to upstream proxy
  const upstreamSocket = new Socket();

  return new Promise((resolve, reject) => {
    let tunnelEstablished = false;
    let responseBuffer = "";

    upstreamSocket.on("error", (err) => {
      if (verbose) {
        console.error(`[tunnel] Upstream error: ${err.message}`);
      }
      if (!tunnelEstablished) {
        clientSocket.write("HTTP/1.1 502 Bad Gateway\r\n\r\n");
      }
      clientSocket.destroy();
      reject(err);
    });

    upstreamSocket.on("close", () => {
      if (verbose) {
        console.log(`[tunnel] Upstream closed for ${targetHost}:${targetPort}`);
      }
      clientSocket.destroy();
      resolve();
    });

    clientSocket.on("error", (err) => {
      if (verbose) {
        console.error(`[tunnel] Client error: ${err.message}`);
      }
      upstreamSocket.destroy();
      reject(err);
    });

    clientSocket.on("close", () => {
      if (verbose) {
        console.log(`[tunnel] Client closed for ${targetHost}:${targetPort}`);
      }
      upstreamSocket.destroy();
      resolve();
    });

    upstreamSocket.connect(upstreamPort, upstreamHost, () => {
      if (verbose) {
        console.log(`[tunnel] Connected to upstream ${upstreamHost}:${upstreamPort}`);
      }

      // Send CONNECT request with JWT auth to upstream
      const connectRequest = buildConnectRequest(targetHost, targetPort, jwtToken);
      upstreamSocket.write(connectRequest);
    });

    // Handle upstream response
    upstreamSocket.on("data", (data) => {
      if (!tunnelEstablished) {
        // Still waiting for upstream's CONNECT response
        responseBuffer += data.toString();

        // Check if we have a complete response
        const headerEnd = responseBuffer.indexOf("\r\n\r\n");
        if (headerEnd !== -1) {
          const statusLine = responseBuffer.split("\r\n")[0];
          const statusMatch = statusLine.match(/HTTP\/\d\.\d\s+(\d+)/);
          const statusCode = statusMatch ? Number.parseInt(statusMatch[1], 10) : 0;

          if (statusCode === 200) {
            tunnelEstablished = true;
            // Always log successful tunnels
            console.log(`[tunnel] ✓ ${targetHost}:${targetPort}`);

            // Send 200 to client
            clientSocket.write("HTTP/1.1 200 Connection Established\r\n\r\n");

            // Now pipe everything bidirectionally
            upstreamSocket.pipe(clientSocket);
            clientSocket.pipe(upstreamSocket);

            // If there was data after the upstream headers, pass it to client
            const remaining = responseBuffer.substring(headerEnd + 4);
            if (remaining.length > 0) {
              clientSocket.write(remaining);
            }

            // If there was data after the client's CONNECT headers, pass it to upstream
            if (head && head.length > 0) {
              upstreamSocket.write(head);
            }
          } else {
            // Always log tunnel failures
            console.error(`[tunnel] ✗ ${targetHost}:${targetPort} - ${statusCode}`);
            if (verbose) {
              console.error(`[tunnel] Full response: ${statusLine}`);
            }
            // Forward the error response to client
            clientSocket.write(`HTTP/1.1 ${statusCode} Proxy Error\r\n\r\n`);
            clientSocket.destroy();
            upstreamSocket.destroy();
            reject(new Error(`Upstream returned ${statusCode}`));
          }
        }
      }
      // After tunnel is established, data flows via pipe()
    });
  });
}

/**
 * Parse a CONNECT request line.
 * Format: CONNECT host:port HTTP/1.1
 */
export function parseConnectRequest(requestLine: string): {
  host: string;
  port: number;
} | null {
  const match = requestLine.match(/^CONNECT\s+([^:]+):(\d+)\s+HTTP/i);
  if (!match) {
    return null;
  }
  return {
    host: match[1],
    port: Number.parseInt(match[2], 10),
  };
}
