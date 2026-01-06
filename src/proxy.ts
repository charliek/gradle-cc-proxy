/**
 * Main HTTP proxy server for Gradle in Claude Code environment.
 *
 * This proxy:
 * 1. Listens on localhost:8899 (configurable)
 * 2. Handles CONNECT requests for HTTPS tunneling
 * 3. Handles HTTP requests by forwarding with JWT auth
 * 4. Only runs in Claude Code environment (auto-detect)
 */

import { type IncomingMessage, type Server, type ServerResponse, createServer } from "node:http";
import type { Socket } from "node:net";
import { buildProxyAuthHeader } from "./auth";
import { type ProxyConfig, isClaudeCodeEnvironment, loadConfig, sanitizeToken } from "./config";
import { handleConnect, parseConnectRequest } from "./tunnel";

let config: ProxyConfig;
let server: Server;

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

  if (config.verbose) {
    console.log(`[http] ${req.method} ${url}`);
  }

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

    // Build request to upstream proxy
    const proxyUrl = `http://${config.upstreamHost}:${config.upstreamPort}`;
    const authHeader = buildProxyAuthHeader(config.jwtToken);

    // Collect request body if any
    const bodyChunks: Buffer[] = [];
    for await (const chunk of req) {
      bodyChunks.push(chunk);
    }
    const body = bodyChunks.length > 0 ? Buffer.concat(bodyChunks) : undefined;

    // Forward headers, adding proxy auth
    const headers: Record<string, string> = {};
    for (const [key, value] of Object.entries(req.headers)) {
      if (value && key.toLowerCase() !== "proxy-authorization") {
        headers[key] = Array.isArray(value) ? value.join(", ") : value;
      }
    }
    headers["Proxy-Authorization"] = authHeader;

    if (config.verbose) {
      console.log(`[http] Forwarding to ${targetUrl.host} via ${proxyUrl}`);
    }

    // Make request through upstream proxy using fetch
    const response = await fetch(url, {
      method: req.method,
      headers,
      body,
      proxy: proxyUrl,
    });

    // Forward response back to client
    res.writeHead(response.status, Object.fromEntries(response.headers));

    if (response.body) {
      const reader = response.body.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        res.write(value);
      }
    }
    res.end();
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

  // Pass the head buffer to be forwarded after tunnel is established
  handleConnect(clientSocket, parsed.host, parsed.port, config, head).catch((err) => {
    if (config.verbose) {
      console.error(`[connect] Error: ${err.message}`);
    }
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

  // Set up signal handlers
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  // Start the server
  startServer();
}

main();
