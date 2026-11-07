import { afterEach, describe, expect, it, vi } from "vitest";
import { inspectRepository, parseRepository, readRepositoryFile } from "./github.js";

describe("repository identifier validation", () => {
  it("accepts owner/name slugs", () => {
    expect(parseRepository("octocat/hello-world").fullName).toBe("octocat/hello-world");
  });
  it("accepts HTTPS GitHub URLs and strips .git", () => {
    expect(parseRepository("https://github.com/octocat/demo.git").fullName).toBe("octocat/demo");
  });
  it("rejects insecure and non-GitHub URLs", () => {
    expect(() => parseRepository("http://github.com/octocat/demo")).toThrow();
    expect(() => parseRepository("https://example.com/octocat/demo")).toThrow();
  });
  it("rejects malformed slugs", () => {
    expect(() => parseRepository("octocat")).toThrow();
    expect(() => parseRepository("octocat/demo/extra")).toThrow();
  });
});

describe("read-only GitHub operations", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("returns a bounded repository snapshot", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ default_branch: "main", description: "demo", visibility: "public" })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ tree: [
        { path: "README.md", type: "blob", size: 4 },
        { path: "src/index.ts", type: "blob", size: 20 }
      ] })))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        type: "file", encoding: "base64", size: 4, content: Buffer.from("demo").toString("base64")
      })));
    vi.stubGlobal("fetch", fetchMock);
    const snapshot = await inspectRepository("octocat/demo", 1);
    expect(snapshot.fileCount).toBe(2);
    expect(snapshot.paths).toEqual(["README.md"]);
    expect(snapshot.truncated).toBe(true);
    expect(snapshot.readme).toBe("demo");
  });
  it("rejects path traversal before making a request", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(readRepositoryFile("octocat/demo", "../secrets")).rejects.toThrow("Invalid repository file path");
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("rejects non-file responses", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ type: "dir" }))));
    await expect(readRepositoryFile("octocat/demo", "src")).rejects.toThrow("not a regular text file");
  });
});
