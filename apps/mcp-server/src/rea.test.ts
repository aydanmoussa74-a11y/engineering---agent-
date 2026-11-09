import { describe, expect, it } from "vitest";
import { analyzeImportGraph, analyzeRepositoryStructure, analyzeSymbolIndex } from "./rea.js";

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

  it("ranks manifest-declared runtime entrypoints ahead of filename guesses", () => {
    const report = analyzeRepositoryStructure(
      ["src/main.ts", "src/core.ts", "src/server.ts", "package.json"],
      [{
        path: "package.json",
        content: JSON.stringify({
          scripts: {
            dev: "tsx src/main.ts",
            start: "node dist/server.js"
          }
        })
      }],
      [
        { path: "src/main.ts", content: 'import { start } from "./core";' },
        { path: "src/server.ts", content: 'export const server = true;' }
      ]
    );

    expect(report.entrypointCandidates[0]).toMatchObject({
      path: "src/main.ts",
      declaredByScripts: ["dev"],
      incomingReferences: 0
    });
    expect(report.entrypointCandidates.find((item) => item.path === "src/server.ts")?.reason)
      .toContain("no incoming imports");
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
    expect(report.entrypointCandidates[0]?.path).toBe("main.py");
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

describe("bounded static symbol index", () => {
  it("indexes declarations and reports lexical cross-file references", () => {
    const index = analyzeSymbolIndex([
      { path: "src/core.ts", content: "export function boot() { return true; }\nclass InternalEngine {}" },
      { path: "src/main.ts", content: 'import { boot } from "./core";\nboot();' }
    ]);

    expect(index.symbols).toEqual(expect.arrayContaining([
      expect.objectContaining({
        path: "src/core.ts",
        name: "boot",
        kind: "function",
        exported: true,
        line: 1,
        referencedByFiles: ["src/main.ts"]
      }),
      expect.objectContaining({
        path: "src/core.ts",
        name: "InternalEngine",
        kind: "class",
        exported: false
      })
    ]));
    expect(index.crossFileReferenceCount).toBe(1);
  });
});

describe("bounded JavaScript and TypeScript import graph", () => {
  it("resolves relative imports and reports central modules and external packages", () => {
    const paths = ["src/main.ts", "src/core.ts", "src/ui/App.tsx", "src/ui/index.ts"];
    const graph = analyzeImportGraph(paths, [
      { path: "src/main.ts", content: 'import { start } from "./core"; import React from "react";' },
      { path: "src/ui/App.tsx", content: 'export { default } from "./index"; import { start } from "../core";' },
      { path: "src/ui/index.ts", content: 'export const view = true;' }
    ]);
    expect(graph.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({ from: "src/main.ts", to: "src/core.ts" }),
      expect.objectContaining({ from: "src/ui/App.tsx", to: "src/ui/index.ts" }),
      expect.objectContaining({ from: "src/ui/App.tsx", to: "src/core.ts" })
    ]));
    expect(graph.externalPackages).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "react", referencedByCount: 1 })
    ]));
    expect(graph.centralModules[0]).toMatchObject({
      path: "src/core.ts",
      incomingReferences: 2,
      scanned: false
    });
  });

  it("keeps unresolved relative imports explicit and does not claim they are broken", () => {
    const graph = analyzeImportGraph(["src/main.ts"], [
      { path: "src/main.ts", content: 'import "./generated/virtual";' }
    ]);
    expect(graph.unresolvedRelativeImports).toEqual([
      { from: "src/main.ts", specifier: "./generated/virtual" }
    ]);
    expect(graph.limitations.some((item) => item.includes("not proof of a broken import"))).toBe(true);
  });

  it("ignores non-relative package aliases and unscanned files", () => {
    const graph = analyzeImportGraph(["src/main.ts", "src/other.ts"], [
      { path: "src/main.ts", content: 'import data from "#internal/data";' },
      { path: "not-in-tree.ts", content: 'import "./missing";' }
    ]);
    expect(graph.edges).toEqual([]);
    expect(graph.unresolvedRelativeImports).toEqual([]);
  });
});
