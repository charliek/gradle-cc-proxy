import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { isClaudeCodeEnvironment, loadConfig, parseProxyUrl, sanitizeToken } from "../config";

describe("parseProxyUrl", () => {
  test("parses full proxy URL with credentials", () => {
    const result = parseProxyUrl("http://user:password123@proxy.example.com:8080");
    expect(result).toEqual({
      host: "proxy.example.com",
      port: 8080,
      username: "user",
      password: "password123",
    });
  });

  test("parses proxy URL without credentials", () => {
    const result = parseProxyUrl("http://proxy.example.com:8080");
    expect(result).toEqual({
      host: "proxy.example.com",
      port: 8080,
      username: undefined,
      password: undefined,
    });
  });

  test("decodes URL-encoded password", () => {
    const result = parseProxyUrl("http://user:pass%40word@proxy.example.com:8080");
    expect(result?.password).toBe("pass@word");
  });

  test("handles JWT token as password", () => {
    const jwt =
      "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U";
    const result = parseProxyUrl(`http://user:${jwt}@21.0.0.93:15004`);
    expect(result?.password).toBe(jwt);
    expect(result?.host).toBe("21.0.0.93");
    expect(result?.port).toBe(15004);
  });

  test("defaults to port 80 for http", () => {
    const result = parseProxyUrl("http://proxy.example.com");
    expect(result?.port).toBe(80);
  });

  test("defaults to port 443 for https", () => {
    const result = parseProxyUrl("https://proxy.example.com");
    expect(result?.port).toBe(443);
  });

  test("returns null for invalid URL", () => {
    const result = parseProxyUrl("not-a-valid-url");
    expect(result).toBeNull();
  });

  test("returns null for empty string", () => {
    const result = parseProxyUrl("");
    expect(result).toBeNull();
  });
});

describe("isClaudeCodeEnvironment", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    process.env.HTTP_PROXY = undefined;
    process.env.http_proxy = undefined;
    process.env.HTTPS_PROXY = undefined;
    process.env.https_proxy = undefined;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  test("returns true when HTTP_PROXY contains Claude Code host", () => {
    process.env.HTTP_PROXY = "http://user:token@21.0.0.93:15004";
    expect(isClaudeCodeEnvironment()).toBe(true);
  });

  test("returns true when HTTPS_PROXY contains Claude Code host", () => {
    process.env.HTTPS_PROXY = "http://user:token@21.0.0.93:15004";
    expect(isClaudeCodeEnvironment()).toBe(true);
  });

  test("returns true when lowercase http_proxy contains Claude Code host", () => {
    process.env.http_proxy = "http://user:token@21.0.0.93:15004";
    expect(isClaudeCodeEnvironment()).toBe(true);
  });

  test("returns false when proxy is different host", () => {
    process.env.HTTP_PROXY = "http://user:token@proxy.example.com:8080";
    expect(isClaudeCodeEnvironment()).toBe(false);
  });

  test("returns false when no proxy is set", () => {
    expect(isClaudeCodeEnvironment()).toBe(false);
  });
});

describe("loadConfig", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    process.env.HTTP_PROXY = undefined;
    process.env.http_proxy = undefined;
    process.env.HTTPS_PROXY = undefined;
    process.env.https_proxy = undefined;
    process.env.PROXY_LOCAL_PORT = undefined;
    process.env.VERBOSE = undefined;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  test("loads config from HTTP_PROXY", () => {
    const jwt =
      "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ";
    process.env.HTTP_PROXY = `http://user:${jwt}@21.0.0.93:15004`;

    const config = loadConfig();
    expect(config.upstreamHost).toBe("21.0.0.93");
    expect(config.upstreamPort).toBe(15004);
    expect(config.jwtToken).toBe(jwt);
    expect(config.localPort).toBe(8899);
    expect(config.verbose).toBe(false);
  });

  test("uses custom local port from environment", () => {
    const jwt =
      "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ";
    process.env.HTTP_PROXY = `http://user:${jwt}@21.0.0.93:15004`;
    process.env.PROXY_LOCAL_PORT = "9999";

    const config = loadConfig();
    expect(config.localPort).toBe(9999);
  });

  test("enables verbose mode from environment", () => {
    const jwt =
      "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ";
    process.env.HTTP_PROXY = `http://user:${jwt}@21.0.0.93:15004`;
    process.env.VERBOSE = "true";

    const config = loadConfig();
    expect(config.verbose).toBe(true);
  });

  test("throws error when no proxy is set", () => {
    expect(() => loadConfig()).toThrow("No proxy environment variable found");
  });

  test("throws error when proxy URL is invalid", () => {
    process.env.HTTP_PROXY = "not-a-valid-url";
    expect(() => loadConfig()).toThrow("Failed to parse proxy URL");
  });

  test("throws error when no JWT token in proxy URL", () => {
    process.env.HTTP_PROXY = "http://21.0.0.93:15004";
    expect(() => loadConfig()).toThrow("No JWT token found");
  });
});

describe("sanitizeToken", () => {
  test("shows first 20 chars for long tokens", () => {
    const token = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0";
    const result = sanitizeToken(token);
    // First 20 chars of the token + "..."
    expect(result).toBe("eyJhbGciOiJIUzI1NiIs...");
  });

  test("returns *** for short tokens", () => {
    const result = sanitizeToken("short");
    expect(result).toBe("***");
  });

  test("returns *** for exactly 20 char tokens", () => {
    const result = sanitizeToken("12345678901234567890");
    expect(result).toBe("***");
  });

  test("shows prefix for 21 char tokens", () => {
    const result = sanitizeToken("123456789012345678901");
    expect(result).toBe("12345678901234567890...");
  });
});
