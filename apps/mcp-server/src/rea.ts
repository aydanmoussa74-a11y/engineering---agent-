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

export function analyzeRepositoryStructure(paths: string[], manifestInputs: ManifestInput[]) {
  const languageCounts = new Map<string, number>();
  const directoryCounts = new Map<string, number>();
  for (const path of paths) {
    const base = fileName(path);
    const extension = base.includes(".") ? base.split(".").pop() ?? "" : "";
    const language = EXTENSION_LANGUAGES[extension];
    if (language) languageCounts.set(language, (languageCounts.get(language) ?? 0) + 1);
    const first = path.split("/")[0];
    if (path.includes("/")) directoryCounts.set(first, (directoryCounts.get(first) ?? 0) + 1);
  }

  const manifests = manifestInputs.map(summarizeManifest).filter((item): item is ManifestSummary => item !== null);
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

  return {
    repository: snapshot.repository,
    defaultBranch: snapshot.defaultBranch,
    visibility: snapshot.visibility,
    fileCount: snapshot.fileCount,
    sampledPathCount: snapshot.paths.length,
    treeTruncated: snapshot.truncated,
    readmeAvailable: snapshot.readme !== null,
    architecture: analyzeRepositoryStructure(snapshot.paths, manifestInputs),
    manifestReadFailures: failures,
    analysisMode: "static, read-only, bounded"
  };
}
