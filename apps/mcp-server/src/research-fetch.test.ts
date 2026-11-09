import { describe, expect, it } from "vitest";
import { extractResearchDocument, isPublicAddress, normalizeResearchTarget } from "./research-fetch.js";

describe("extractResearchDocument", () => {
  it("extracts a bounded title and readable HTML excerpt", () => {
    const result = extractResearchDocument(
      "<html><head><title>Docs &amp; APIs</title></head><body><script>secret()</script><h1>Hello</h1><p>Useful text</p></body></html>",
      "text/html"
    );
    expect(result.title).toBe("Docs & APIs");
    expect(result.excerpt).toContain("Hello");
    expect(result.excerpt).toContain("Useful text");
    expect(result.excerpt).not.toContain("secret()");
  });

  it("preserves bounded plain text without pretending it is HTML", () => {
    const result = extractResearchDocument("plain evidence", "text/plain");
    expect(result).toEqual({ title: "", excerpt: "plain evidence" });
  });
});

describe("normalizeResearchTarget", () => {
  it("allows only standard-port HTTPS hostnames", () => {
    expect(normalizeResearchTarget("https://example.com/docs#section").toString()).toBe("https://example.com/docs");
    expect(() => normalizeResearchTarget("http://example.com")).toThrow(/HTTPS/);
    expect(() => normalizeResearchTarget("https://127.0.0.1")).toThrow(/IP-literal/);
    expect(() => normalizeResearchTarget("https://localhost")).toThrow(/Local/);
    expect(() => normalizeResearchTarget("https://example.com:8443")).toThrow(/standard HTTPS port/);
    expect(() => normalizeResearchTarget("https://user:pass@example.com")).toThrow(/credentials/);
  });
});

describe("isPublicAddress", () => {
  it("rejects private, local, link-local, shared, reserved and documentation ranges", () => {
    for (const address of ["10.0.0.1", "127.0.0.1", "169.254.1.1", "172.16.0.1", "192.168.1.1", "100.64.0.1", "198.18.0.1", "203.0.113.1", "224.0.0.1", "fc00::1", "fe80::1", "2001:db8::1"]) {
      expect(isPublicAddress(address), address).toBe(false);
    }
  });

  it("accepts public IPv4 and global IPv6 addresses", () => {
    expect(isPublicAddress("1.1.1.1")).toBe(true);
    expect(isPublicAddress("2606:4700:4700::1111")).toBe(true);
  });
});
