import { describe, expect, test } from "bun:test";
import { parseConnectRequest } from "../tunnel";

describe("parseConnectRequest", () => {
  test("parses valid CONNECT request", () => {
    const result = parseConnectRequest("CONNECT example.com:443 HTTP/1.1");
    expect(result).toEqual({
      host: "example.com",
      port: 443,
    });
  });

  test("parses CONNECT with different port", () => {
    const result = parseConnectRequest("CONNECT api.example.com:8443 HTTP/1.1");
    expect(result).toEqual({
      host: "api.example.com",
      port: 8443,
    });
  });

  test("parses CONNECT with IP address", () => {
    const result = parseConnectRequest("CONNECT 192.168.1.1:443 HTTP/1.1");
    expect(result).toEqual({
      host: "192.168.1.1",
      port: 443,
    });
  });

  test("handles lowercase connect", () => {
    const result = parseConnectRequest("connect example.com:443 HTTP/1.1");
    expect(result).toEqual({
      host: "example.com",
      port: 443,
    });
  });

  test("handles HTTP/1.0", () => {
    const result = parseConnectRequest("CONNECT example.com:443 HTTP/1.0");
    expect(result).toEqual({
      host: "example.com",
      port: 443,
    });
  });

  test("returns null for invalid format - missing port", () => {
    const result = parseConnectRequest("CONNECT example.com HTTP/1.1");
    expect(result).toBeNull();
  });

  test("returns null for invalid format - missing host", () => {
    const result = parseConnectRequest("CONNECT :443 HTTP/1.1");
    expect(result).toBeNull();
  });

  test("returns null for GET request", () => {
    const result = parseConnectRequest("GET /path HTTP/1.1");
    expect(result).toBeNull();
  });

  test("returns null for empty string", () => {
    const result = parseConnectRequest("");
    expect(result).toBeNull();
  });

  test("handles subdomain hosts", () => {
    const result = parseConnectRequest("CONNECT plugins.gradle.org:443 HTTP/1.1");
    expect(result).toEqual({
      host: "plugins.gradle.org",
      port: 443,
    });
  });

  test("handles port 80", () => {
    const result = parseConnectRequest("CONNECT example.com:80 HTTP/1.1");
    expect(result).toEqual({
      host: "example.com",
      port: 80,
    });
  });
});
