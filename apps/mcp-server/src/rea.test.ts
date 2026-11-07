import { describe, expect, it } from "vitest";
import { analyzeRepositoryStructure } from "./rea.js";

describe("static repository architecture mapping", () => {
  it("classifies observed languages and declared frameworks separately", () => {
    const report = analyzeRepositoryStructure(
      [
        "src/index.ts",
        "src/app.tsx",
        "src/styles.css",
        "apps/web/src/main.ts",
        "README.md"
      ],
      [{
        path: "package.json",
        content: JSON.stringify({
          name: "sample-app",
          version: "1.2.0",
          dependencies: { react: "^19.0.0", vite: "^6.0.0" },
          devDependencies: { typescript: "^5.7.0" },
          scripts: { build: "vite build", test: "vitest run" }
        })
      }]
    );

    expect(report.languages).toEqual(expect.arrayContaining([
      expect.objectContaining({ language: "TypeScript", fileCount: 3 }),
      expect.objectContaining({ language: "CSS", fileCount: 1 })
    ]));
    expect(report.frameworkSignals).toEqual(expect.arrayContaining(["React", "Vite"]));
    expect(report.manifests[0]).toMatchObject({
      path: "package.json",
      ecosystem: "Node.js",
      name: "sample-app",
      dependencyCount: 3
    });
    expect(report.entrypointCandidates).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: "src/index.ts", classification: "inferred" }),
      expect.objectContaining({ path: "apps/web/src/main.ts", classification: "inferred" })
    ]));
    expect(report.evidence.some((item) => item.classification === "observed")).toBe(true);
    expect(report.evidence.some((item) => item.classification === "documented")).toBe(true);
    expect(report.evidence.some((item) => item.classification === "inferred")).toBe(true);
  });

  it("keeps malformed manifests as unknown instead of failing the whole report", () => {
    const report = analyzeRepositoryStructure(
      ["main.py", "pyproject.toml"],
      [{ path: "package.json", content: "{not valid json" }]
    );

    expect(report.manifests[0]).toMatchObject({
      ecosystem: "Unknown",
      name: null,
      dependencyCount: 0
    });
    expect(report.entrypointCandidates[0].path).toBe("main.py");
  });

  it("does not invent framework signals when no manifest declares one", () => {
    const report = analyzeRepositoryStructure(["src/main.go", "README.md"], []);
    expect(report.frameworkSignals).toEqual([]);
    expect(report.manifests).toEqual([]);
    expect(report.entrypointCandidates[0]).toMatchObject({
      path: "src/main.go",
      classification: "inferred"
    });
  });
});
