import { inspectRepository, readRepositoryFile, type RepositorySnapshot } from "./github.js";

const MANIFEST_NAMES = new Set([
  "package.json", "pyproject.toml", "requirements.txt", "go.mod", "cargo.toml",
  "composer.json", "pom.xml", "build.gradle", "build.gradle.kts", "gemfile",
  "deno.json", "deno.jsonc"
]);

const EXTENSION_LANGUAGES: Record<string, string> = {
  ts: "TypeScript", tsx: "TypeScript", js: "JavaScript", jsx: "JavaScript",
  mjs: "JavaScript", cjs: "JavaScript", py: "Python", pyw: "Python",
  go: "Go", rs: "Rust", java: "Java", kt: "Kotlin", kts: "Kotlin",
  cs: "C#", fs: "F#", cpp: "C++", cc: "C++", cxx: "C++", c: "C",
  h: "C/C++", hpp: "C++", rb: "Ruby", php: "PHP", swift: "Swift",
  dart: "Dart", scala: "Scala", ex: "Elixir", exs: "Elixir",
  erl: "Erlang", hs: "Haskell", lua: "Lua", sh: "Shell", bash: "Shell",
  sql: "SQL", html: "HTML", css: "CSS", scss: "SCSS", vue: "Vue",
  svelte: "Svelte", astro: "Astro"
};

type ManifestInput = { path: string; content: string };
type ManifestSummary = {
  path: string;
  ecosystem: string;
  name: string | null;
  version: string | null;
  dependencyCount: number;
  scripts: string[];
  frameworks: string[];
};

const FRAMEWORKS: Array<{ packageName: string; label: string }> = [
  { packageName: "next", label: "Next.js" },
  { packageName: "react", label: "React" },
  { packageName: "vite", label: "Vite" },
  { packageName: "express", label: "Express" },
  { packageName: "fastify", label: "Fastify" },
  { packageName: "hono", label: "Hono" },
  { packageName: "@nestjs/core", label: "NestJS" },
  { packageName: "astro", label: "Astro" },
  { packageName: "vue", label: "Vue" },
  { packageName: "svelte", label: "Svelte" },
  { packageName: "@angular/core", label: "Angular" },
  { packageName: "electron", label: "Electron" },
  { packageName: "tauri", label: "Tauri" }
];

function fileName(path: string): string {
  return path.split("/").pop()?.toLowerCase() ?? path.toLowerCase();
}

function packageSummary(path: string, content: string): ManifestSummary {
  const parsed = JSON.parse(content) as {
    name?: string;
    version?: string;
    dependencies?: Record<string, unknown>;
    devDependencies?: Record<string, unknown>;
    peerDependencies?: Record<string, unknown>;
    optionalDependencies?: Record<string, unknown>;
    scripts?: Record<string, unknown>;
  };
  const deps = {
    ...parsed.dependencies,
    ...parsed.devDependencies,
    ...parsed.peerDependencies,
    ...parsed.optionalDependencies
  };
  const names = new Set(Object.keys(deps));
  return {
    path,
    ecosystem: "Node.js",
    name: parsed.name ?? null,
    version: parsed.version ?? null,
    dependencyCount: names.size,
    scripts: Object.keys(parsed.scripts ?? {}).slice(0, 30),
    frameworks: FRAMEWORKS.filter((item) => names.has(item.packageName)).map((item) => item.label)
  };
}

function textManifestSummary(path: string, content: string): ManifestSummary {
  const lower = content.toLowerCase();
  const frameworks: string[] = [];
  const signals: Array<[RegExp, string]> = [
    [/\bfastapi\b/, "FastAPI"], [/\bdjango\b/, "Django"],
    [/\bflask\b/, "Flask"], [/\bstarlette\b/, "Starlette"],
    [/\bstreamlit\b/, "Streamlit"], [/\bpytest\b/, "pytest"],
    [/\bgin-gonic\b/, "Gin"], [/\becho\b/, "Echo"],
    [/\bactix-web\b/, "Actix Web"], [/\btokio\b/, "Tokio"],
    [/\bspring-boot\b/, "Spring Boot"], [/\brails\b/, "Ruby on Rails"]
  ];
  for (const [pattern, label] of signals) if (pattern.test(lower)) frameworks.push(label);
  const nameMatch = content.match(/^\s*(?:name|module)\s*=\s*["']?([^\s"'#]+)/m);
  const versionMatch = content.match(/^\s*version\s*=\s*["']([^"']+)/m);
  const dependencyCount = (content.match(/^\s*[A-Za-z0-9_.@/-]+\s*(?:=|~=|>=|\s)/gm) ?? []).length;
  const ecosystem = /pyproject\.toml|requirements\.txt/i.test(path) ? "Python"
    : /go\.mod/i.test(path) ? "Go"
    : /cargo\.toml/i.test(path) ? "Rust"
    : /composer\.json/i.test(path) ? "PHP"
    : /pom\.xml|build\.gradle/i.test(path) ? "JVM"
    : /gemfile/i.test(path) ? "Ruby"
    : /deno\.json/i.test(path) ? "Deno"
    : "Unknown";
  return {
    path,
    ecosystem,
    name: nameMatch?.[1] ?? null,
    version: versionMatch?.[1] ?? null,
    dependencyCount,
    scripts: [],
    frameworks
  };
}

function summarizeManifest(input: ManifestInput): ManifestSummary | null {
  const name = fileName(input.path);
  try {
    if (name === "package.json" || name === "composer.json" || name === "deno.json" || name === "deno.jsonc") {
      if (name === "package.json") return packageSummary(input.path, input.content);
      const parsed = JSON.parse(input.content) as { name?: string; version?: string; require?: Record<string, unknown>; requireDev?: Record<string, unknown> };
      const deps = { ...parsed.require, ...parsed.requireDev };
      return {
        path: input.path,
        ecosystem: name === "composer.json" ? "PHP" : "Deno",
        name: parsed.name ?? null,
        version: parsed.version ?? null,
        dependencyCount: Object.keys(deps).length,
        scripts: [],
        frameworks: []
      };
    }
    return textManifestSummary(input.path, input.content);
  } catch {
    return {
      path: input.path,
      ecosystem: "Unknown",
      name: null,
      version: null,
      dependencyCount: 0,
      scripts: [],
      frameworks: []
    };
  }
}


type SourceInput = { path: string; content: string };

const SOURCE_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"];
const IMPORT_PATTERN = /(?:\bimport\s+(?:[^"'()]*?\s+from\s*)?|\bexport\s+[^"'()]*?\s+from\s*|\bimport\s*\(|\brequire\s*\()(["'])([^"']+)\1\s*\)?/g;

function resolveRelativeImport(fromPath: string, specifier: string, knownPaths: Set<string>): string | null {
  const parts = fromPath.split("/");
  parts.pop();
  for (const part of specifier.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") parts.pop();
    else parts.push(part);
  }
  const base = parts.join("/");
  const candidates = [base, ...SOURCE_EXTENSIONS.map((ext) => base + ext),
    ...SOURCE_EXTENSIONS.map((ext) => base + "/index" + ext)];
  return candidates.find((candidate) => knownPaths.has(candidate)) ?? null;
}

export function analyzeImportGraph(paths: string[], sourceInputs: SourceInput[]) {
  const knownPaths = new Set(paths);
  const edges: Array<{ from: string; to: string; specifier: string; classification: string }> = [];
  const externalImports = new Map<string, Set<string>>();
  const unresolvedImports: Array<{ from: string; specifier: string }> = [];
  const scanned = new Set<string>();

  for (const input of sourceInputs) {
    if (!knownPaths.has(input.path)) continue;
    scanned.add(input.path);
    IMPORT_PATTERN.lastIndex = 0;
    for (const match of input.content.matchAll(IMPORT_PATTERN)) {
      const specifier = match[2];
      if (!specifier) continue;
      if (specifier.startsWith(".")) {
        const target = resolveRelativeImport(input.path, specifier, knownPaths);
        if (target) edges.push({ from: input.path, to: target, specifier, classification: "observed_static_reference" });
        else unresolvedImports.push({ from: input.path, specifier });
      } else if (!specifier.startsWith("/") && !specifier.startsWith("#")) {
        const packageName = specifier.startsWith("@") ? specifier.split("/").slice(0, 2).join("/") : specifier.split("/")[0];
        if (packageName) {
          const users = externalImports.get(packageName) ?? new Set<string>();
          users.add(input.path);
          externalImports.set(packageName, users);
        }
      }
    }
  }

  const incoming = new Map<string, number>();
  const outgoing = new Map<string, number>();
  for (const edge of edges) {
    outgoing.set(edge.from, (outgoing.get(edge.from) ?? 0) + 1);
    incoming.set(edge.to, (incoming.get(edge.to) ?? 0) + 1);
  }
  const connectedFiles = [...scanned].filter((path) => (incoming.get(path) ?? 0) + (outgoing.get(path) ?? 0) > 0);
  const centralModules = [...scanned]
    .map((path) => ({ path, incomingReferences: incoming.get(path) ?? 0, outgoingReferences: outgoing.get(path) ?? 0 }))
    .filter((item) => item.incomingReferences > 0 || item.outgoingReferences > 0)
    .sort((a, b) => b.incomingReferences - a.incomingReferences || (b.incomingReferences + b.outgoingReferences) - (a.incomingReferences + a.outgoingReferences) || a.path.localeCompare(b.path))
    .slice(0, 20);
  return {
    scannedFileCount: scanned.size,
    edgeCount: edges.length,
    edges: edges.slice(0, 500),
    externalPackages: [...externalImports.entries()].map(([name, users]) => ({ name, referencedByCount: users.size, sampleFiles: [...users].slice(0, 5) })).sort((a, b) => b.referencedByCount - a.referencedByCount).slice(0, 50),
    centralModules,
    disconnectedScannedFiles: [...scanned].filter((path) => !connectedFiles.includes(path)).slice(0, 50),
    unresolvedRelativeImports: unresolvedImports.slice(0, 100),
    limitations: [
      "Only literal import, export-from, require and dynamic-import specifiers in scanned JavaScript/TypeScript files are considered.",
      "Path aliases, package export maps, generated modules, conditional resolution and non-JavaScript languages are not resolved.",
      "A missing target may be outside the sampled tree or use an unsupported resolution rule; it is not proof of a broken import."
    ]
  };
}

export function analyzeRepositoryStructure(paths: string[], manifestInputs: ManifestInput[], sourceInputs: SourceInput[] = []) {
  const languageCounts = new Map<string, number>();
  const directoryCounts = new Map<string, number>();
  for (const path of paths) {
    const base = fileName(path);
    const extension = base.includes(".") ? base.split(".").pop() ?? "" : "";
    const language = EXTENSION_LANGUAGES[extension];
    if (language) languageCounts.set(language, (languageCounts.get(language) ?? 0) + 1);
    const first = path.split("/")[0];
    if (path.includes("/") && first) directoryCounts.set(first, (directoryCounts.get(first) ?? 0) + 1);
  }

  const manifests = manifestInputs.map(summarizeManifest).filter((item): item is ManifestSummary => item !== null);
  const importGraph = analyzeImportGraph(paths, sourceInputs);
  const frameworkSignals = [...new Set(manifests.flatMap((item) => item.frameworks))];
  const entrypointCandidates = paths
    .filter((path) => /(^|\/)(index|main|app|server|manage|cli)\.(ts|tsx|js|jsx|mjs|cjs|py|go|rs|java|php|rb)$/i.test(path))
    .slice(0, 30)
    .map((path) => ({
      path,
      classification: "inferred",
      reason: "Conventional entrypoint filename; execution flow has not yet been traced."
    }));

  const languages = [...languageCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([language, fileCount]) => ({ language, fileCount }));
  const topLevelDirectories = [...directoryCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 30)
    .map(([directory, fileCount]) => ({ directory, fileCount }));

  const evidence = [
    {
      claim: "File and directory inventory was read from the GitHub repository tree.",
      classification: "observed",
      confidence: "high",
      sourcePaths: []
    },
    ...languages.map((item) => ({
      claim: item.language + " files were identified by extension (" + item.fileCount + " sampled files).",
      classification: "observed",
      confidence: "high",
      sourcePaths: paths.filter((path) => {
        const extension = fileName(path).split(".").pop() ?? "";
        return EXTENSION_LANGUAGES[extension] === item.language;
      }).slice(0, 10)
    })),
    ...manifests.map((item) => ({
      claim: item.ecosystem + " project manifest was found" + (item.name ? " for " + item.name : "") + ".",
      classification: "documented",
      confidence: "high",
      sourcePaths: [item.path]
    })),
    ...frameworkSignals.map((framework) => ({
      claim: framework + " is declared in a repository manifest.",
      classification: "documented",
      confidence: "high",
      sourcePaths: manifests.filter((item) => item.frameworks.includes(framework)).map((item) => item.path)
    })),
    ...entrypointCandidates.map((item) => ({
      claim: "Potential entrypoint: " + item.path + ".",
      classification: "inferred",
      confidence: "medium",
      sourcePaths: [item.path]
    }))
  ];

  return {
    languages,
    topLevelDirectories,
    manifests,
    frameworkSignals,
    entrypointCandidates,
    importGraph,
    evidence,
    limitations: [
      "This is bounded static repository analysis, not proof of runtime behavior.",
      "Entrypoint candidates are inferred from conventional filenames and still need import/call-graph tracing.",
      "Only selected manifest files and the sampled repository tree were inspected.",
      "No dependency installation, code execution, or deployment was performed."
    ]
  };
}

export async function mapRepositoryArchitecture(input: string, maxFiles = 120) {
  const snapshot: RepositorySnapshot = await inspectRepository(input, maxFiles);
  const manifestPaths = snapshot.paths
    .filter((path) => MANIFEST_NAMES.has(fileName(path)))
    .slice(0, 8);
  const manifestInputs: ManifestInput[] = [];
  const failures: string[] = [];
  let remainingBytes = 160_000;

  for (const path of manifestPaths) {
    if (remainingBytes <= 0) break;
    try {
      const content = await readRepositoryFile(snapshot.repository.fullName, path, snapshot.defaultBranch);
      const bounded = content.slice(0, Math.min(content.length, remainingBytes, 40_000));
      manifestInputs.push({ path, content: bounded });
      remainingBytes -= Buffer.byteLength(bounded, "utf8");
    } catch {
      failures.push(path);
    }
  }

  const sourceInputs: SourceInput[] = [];
  const sourcePaths = snapshot.paths.filter((path) => /\\.(ts|tsx|js|jsx|mjs|cjs)$/i.test(path)).slice(0, 50);
  for (const path of sourcePaths) {
    if (remainingBytes <= 0) break;
    try {
      const content = await readRepositoryFile(snapshot.repository.fullName, path, snapshot.defaultBranch);
      const bounded = content.slice(0, Math.min(content.length, remainingBytes, 5_000));
      sourceInputs.push({ path, content: bounded });
      remainingBytes -= Buffer.byteLength(bounded, "utf8");
    } catch {
      failures.push(path);
    }
  }

  return {
    repository: snapshot.repository,
    defaultBranch: snapshot.defaultBranch,
    visibility: snapshot.visibility,
    fileCount: snapshot.fileCount,
    sampledPathCount: snapshot.paths.length,
    treeTruncated: snapshot.truncated,
    readmeAvailable: snapshot.readme !== null,
    architecture: analyzeRepositoryStructure(snapshot.paths, manifestInputs, sourceInputs),
    manifestReadFailures: failures,
    analysisMode: "static, read-only, bounded"
  };
}
