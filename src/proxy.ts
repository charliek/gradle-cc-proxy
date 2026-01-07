/**
 * Main HTTP proxy server for Gradle in Claude Code environment.
 *
 * This proxy:
 * 1. Listens on localhost:8899 (configurable)
 * 2. Handles CONNECT requests for HTTPS tunneling
 * 3. Handles HTTP requests by forwarding with JWT auth
 * 4. Only runs in Claude Code environment (auto-detect)
 */

import {
  type IncomingMessage,
  type Server,
  type ServerResponse,
  createServer,
  request as httpRequest,
} from "node:http";
import type { Socket } from "node:net";
import { buildProxyAuthHeader } from "./auth";
import { type ProxyConfig, isClaudeCodeEnvironment, loadConfig, sanitizeToken } from "./config";
import { ConnectionLimiter } from "./throttle";
import { handleConnect, parseConnectRequest } from "./tunnel";

let config: ProxyConfig;
let server: Server;
let limiter: ConnectionLimiter;

/**
 * Handle HTTP requests (non-CONNECT).
 * Forward to upstream proxy with JWT authentication.
 *
 * Note: Most Gradle traffic uses HTTPS (CONNECT tunneling).
 * This handles the rare plain HTTP requests.
 */
async function handleHttpRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = req.url;
  if (!url) {
    res.writeHead(400);
    res.end("Bad Request: No URL");
    return;
  }

  // Always log requests for debugging (brief format)
  console.log(`[http] ${req.method} ${url}`);

  try {
    // Validate the URL is absolute (required for proxy requests)
    let targetUrl: URL;
    try {
      targetUrl = new URL(url);
    } catch {
      res.writeHead(400);
      res.end("Bad Request: Invalid URL");
      return;
    }

    const authHeader = buildProxyAuthHeader(config.jwtToken);

    // Collect request body if any
    const bodyChunks: Buffer[] = [];
    for await (const chunk of req) {
      bodyChunks.push(chunk);
    }
    const body = bodyChunks.length > 0 ? Buffer.concat(bodyChunks) : undefined;

    // Forward headers, adding proxy auth
    const headers: Record<string, string | string[]> = {};
    for (const [key, value] of Object.entries(req.headers)) {
      if (value && key.toLowerCase() !== "proxy-authorization") {
        headers[key] = value;
      }
    }
    headers["Proxy-Authorization"] = authHeader;

    if (config.verbose) {
      console.log(
        `[http] Forwarding to ${targetUrl.host} via ${config.upstreamHost}:${config.upstreamPort}`
      );
    }

    // Make request through upstream proxy using http.request
    // For HTTP proxying, we send the request TO the proxy but with the FULL URL in the path
    const proxyReq = httpRequest({
      method: req.method,
      host: config.upstreamHost,
      port: config.upstreamPort,
      path: url, // Full URL for proxy requests
      headers: headers,
    });

    proxyReq.on("error", (err) => {
      if (config.verbose) {
        console.error(`[http] Proxy request error: ${err.message}`);
      }
      res.writeHead(502);
      res.end("Bad Gateway");
    });

    proxyReq.on("response", (proxyRes) => {
      // Always log responses for debugging
      console.log(`[http] ${proxyRes.statusCode} ${req.method} ${targetUrl.host}`);

      // Forward response headers and status
      res.writeHead(proxyRes.statusCode || 500, proxyRes.headers);

      // Pipe response body
      proxyRes.pipe(res);
    });

    // Send request body if present
    if (body) {
      proxyReq.write(body);
    }

    proxyReq.end();
  } catch (err) {
    if (config.verbose) {
      console.error(`[http] Error forwarding request: ${err}`);
    }
    res.writeHead(502);
    res.end("Bad Gateway");
  }
}

/**
 * Handle CONNECT method for HTTPS tunneling.
 * The head buffer contains any data already read after the CONNECT headers.
 */
function handleConnectRequest(req: IncomingMessage, clientSocket: Socket, head: Buffer): void {
  const parsed = parseConnectRequest(`CONNECT ${req.url} HTTP/1.1`);
  if (!parsed) {
    clientSocket.write("HTTP/1.1 400 Bad Request\r\n\r\n");
    clientSocket.destroy();
    return;
  }

  // Acquire a connection slot (may queue if at limit)
  limiter
    .acquire()
    .then(() => {
      // Pass the head buffer to be forwarded after tunnel is established
      return handleConnect(clientSocket, parsed.host, parsed.port, config, head);
    })
    .catch((err) => {
      if (config.verbose) {
        console.error(`[connect] Error: ${err.message}`);
      }
    })
    .finally(() => {
      // Always release the slot when the connection closes
      limiter.release();
    });
}

/**
 * Start the proxy server.
 */
function startServer(): void {
  server = createServer(handleHttpRequest);

  // Handle CONNECT method
  server.on("connect", handleConnectRequest);

  // Error handling
  server.on("error", (err) => {
    console.error(`[server] Error: ${err.message}`);
    process.exit(1);
  });

  // Start listening
  server.listen(config.localPort, "127.0.0.1", () => {
    console.log(`[proxy] Gradle proxy started on localhost:${config.localPort}`);
    console.log(`[proxy] Upstream: ${config.upstreamHost}:${config.upstreamPort}`);
    console.log(`[proxy] Token: ${sanitizeToken(config.jwtToken)}`);
    if (config.maxConcurrent > 0) {
      console.log(`[proxy] Throttle: max ${config.maxConcurrent} concurrent connections`);
    }
    if (config.verbose) {
      console.log("[proxy] Verbose logging enabled");
    }
  });
}

/**
 * Graceful shutdown.
 */
function shutdown(): void {
  console.log("\n[proxy] Shutting down...");
  if (server) {
    server.close(() => {
      console.log("[proxy] Server closed");
      process.exit(0);
    });
    // Force exit after 5 seconds
    setTimeout(() => {
      console.log("[proxy] Forcing exit");
      process.exit(0);
    }, 5000);
  } else {
    process.exit(0);
  }
}

/**
 * Main entry point.
 */
function main(): void {
  console.log("[proxy] Gradle Proxy Adapter v1.0.0");
  console.log("[proxy] Checking environment...");

  // Check if we're in Claude Code environment
  if (!isClaudeCodeEnvironment()) {
    console.log("[proxy] Not in Claude Code environment.");
    console.log("[proxy] This tool requires CLAUDE_CODE_REMOTE=true to be set.");
    process.exit(0);
  }

  console.log("[proxy] Claude Code environment detected");

  // Load configuration
  try {
    config = loadConfig();
  } catch (err) {
    console.error(`[proxy] Configuration error: ${err}`);
    process.exit(1);
  }

  // Initialize connection limiter
  limiter = new ConnectionLimiter(config.maxConcurrent, config.verbose);

  // Set up signal handlers
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  // Start the server
  startServer();
}

main();
