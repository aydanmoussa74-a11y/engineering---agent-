import { describe, expect, it } from "vitest";
import { createFixedWindowRateLimiter, isAllowedHost, isAuthorizedBearer } from "./security.js";

describe("remote HTTP security helpers", () => {
  it("accepts only the configured bearer token", () => {
    expect(isAuthorizedBearer("Bearer secret-token", "secret-token")).toBe(true);
    expect(isAuthorizedBearer("bearer secret-token", "secret-token")).toBe(true);
    expect(isAuthorizedBearer(undefined, "secret-token")).toBe(false);
    expect(isAuthorizedBearer("Basic secret-token", "secret-token")).toBe(false);
    expect(isAuthorizedBearer("Bearer wrong-token", "secret-token")).toBe(false);
    expect(isAuthorizedBearer("Bearer secret-token extra", "secret-token")).toBe(false);
  });

  it("requires an exact configured host", () => {
    expect(isAllowedHost("engineering-agent-mcp.onrender.com", "engineering-agent-mcp.onrender.com")).toBe(true);
    expect(isAllowedHost("ENGINEERING-AGENT-MCP.ONRENDER.COM", "engineering-agent-mcp.onrender.com")).toBe(true);
    expect(isAllowedHost("attacker.example", "engineering-agent-mcp.onrender.com")).toBe(false);
    expect(isAllowedHost(undefined, "engineering-agent-mcp.onrender.com")).toBe(false);
  });

  it("allows only local or Render hosts when no explicit host is configured", () => {
    expect(isAllowedHost("localhost:3000", "")).toBe(true);
    expect(isAllowedHost("127.0.0.1:3000", "")).toBe(true);
    expect(isAllowedHost("engineering-agent-mcp.onrender.com", "")).toBe(true);
    expect(isAllowedHost("attacker.example", "")).toBe(false);
  });

  it("enforces a fixed window and resets after expiry", () => {
    const allow = createFixedWindowRateLimiter({ limit: 2, windowMs: 1_000 });
    expect(allow("credential", 100)).toBe(true);
    expect(allow("credential", 200)).toBe(true);
    expect(allow("credential", 300)).toBe(false);
    expect(allow("credential", 1_100)).toBe(true);
  });

  it("keeps separate authenticated principals in separate windows", () => {
    const allow = createFixedWindowRateLimiter({ limit: 1, windowMs: 1_000 });
    expect(allow("principal-a", 100)).toBe(true);
    expect(allow("principal-a", 200)).toBe(false);
    expect(allow("principal-b", 200)).toBe(true);
  });
});
