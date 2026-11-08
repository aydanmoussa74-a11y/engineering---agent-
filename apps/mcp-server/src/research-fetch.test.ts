import { describe, expect, it } from "vitest";
import { extractResearchDocument } from "./research-fetch.js";

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
