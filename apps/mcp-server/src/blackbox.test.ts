import { describe, expect, it } from "vitest";
import { analyzeCapturedWebSurface } from "./blackbox.js";

describe("analyzeCapturedWebSurface", () => {
  it("extracts document structure, routes, forms and assets without fetching them", () => {
    const report = analyzeCapturedWebSurface(
      '<html><head><title>Demo</title><meta name="description" content="A demo"></head><body><nav><a href="/pricing">Pricing</a><a href="https://other.example/x">External</a></nav><main><h1>Welcome</h1><form action="/login" method="post"><input name="email" type="email" required></form><img src="/hero.png" alt="Hero"><script src="/app.js"></script></main></body></html>',
      "https://demo.example/"
    );
    expect(report.document.title).toBe("Demo");
    expect(report.routeCandidates).toContain("/pricing");
    expect(report.forms[0]?.fields[0]).toEqual({ name: "email", type: "email", required: true });
    expect(report.externalOrigins).toContain("https://other.example");
    expect(report.scripts).toContain("/app.js");
    expect(report.analysisMode).toBe("offline_user_supplied_capture");
  });

  it("rejects oversized captures and never resolves an unsafe source URL", () => {
    expect(() => analyzeCapturedWebSurface("x".repeat(500_001))).toThrow(/500 KB/);
    const report = analyzeCapturedWebSurface('<a href="/x">x</a>', "file:///etc/passwd");
    expect(report.source).toBeNull();
    expect(report.routeCandidates).toContain("/x");
  });
});
