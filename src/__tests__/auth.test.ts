import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { buildConnectRequest, buildProxyAuthHeader, logAuthAttempt } from "../auth";

describe("buildProxyAuthHeader", () => {
  test("creates Bearer token header", () => {
    const token = "eyJhbGciOiJIUzI1NiJ9";
    const result = buildProxyAuthHeader(token);
    expect(result).toBe("Bearer eyJhbGciOiJIUzI1NiJ9");
  });

  test("handles empty token", () => {
    const result = buildProxyAuthHeader("");
    expect(result).toBe("Bearer ");
  });
});

describe("buildConnectRequest", () => {
  test("creates valid CONNECT request", () => {
    const token = "jwt-token";
    const result = buildConnectRequest("example.com", 443, token);

    const lines = result.split("\r\n");
    expect(lines[0]).toBe("CONNECT example.com:443 HTTP/1.1");
    expect(lines[1]).toBe("Host: example.com:443");
    expect(lines[2]).toBe("Proxy-Authorization: Bearer jwt-token");
    expect(lines[3]).toBe("Proxy-Connection: keep-alive");
    expect(lines[4]).toBe("");
    expect(lines[5]).toBe("");
  });

  test("handles different ports", () => {
    const result = buildConnectRequest("api.example.com", 8443, "token");
    expect(result).toContain("CONNECT api.example.com:8443 HTTP/1.1");
    expect(result).toContain("Host: api.example.com:8443");
  });

  test("includes JWT in Authorization header", () => {
    const longJwt =
      "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U";
    const result = buildConnectRequest("example.com", 443, longJwt);
    expect(result).toContain(`Proxy-Authorization: Bearer ${longJwt}`);
  });

  test("ends with double CRLF", () => {
    const result = buildConnectRequest("example.com", 443, "token");
    expect(result.endsWith("\r\n\r\n")).toBe(true);
  });
});

describe("logAuthAttempt", () => {
  let consoleLogMock: ReturnType<typeof mock>;
  const originalConsoleLog = console.log;

  beforeEach(() => {
    consoleLogMock = mock(() => {});
    console.log = consoleLogMock;
  });

  afterEach(() => {
    console.log = originalConsoleLog;
  });

  test("logs when verbose is true", () => {
    const longToken = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0";
    logAuthAttempt("proxy.example.com", 8080, longToken, true);
    expect(consoleLogMock).toHaveBeenCalled();
  });

  test("does not log when verbose is false", () => {
    logAuthAttempt("proxy.example.com", 8080, "token", false);
    expect(consoleLogMock).not.toHaveBeenCalled();
  });

  test("sanitizes token in log output", () => {
    const longToken = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0";
    logAuthAttempt("proxy.example.com", 8080, longToken, true);

    const logCall = consoleLogMock.mock.calls[0][0];
    expect(logCall).toContain("proxy.example.com:8080");
    // First 20 chars of the token + "..."
    expect(logCall).toContain("eyJhbGciOiJIUzI1NiIs...");
    expect(logCall).not.toContain(longToken);
  });
});
