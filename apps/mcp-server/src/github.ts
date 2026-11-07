import { z } from "zod";

const slugSchema = z.string().regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/);
const MAX_FILE_BYTES = 100_000;
const MAX_TREE_BYTES = 4_000_000;

export interface RepositorySnapshot {
  repository: { owner: string; name: string; fullName: string };
  description: string | null;
  defaultBranch: string;
  visibility: string;
  fileCount: number;
  truncated: boolean;
  paths: string[];
  readme: string | null;
}

export function parseRepository(input: string) {
  const trimmed = input.trim();
  let slug = trimmed;
  if (trimmed.startsWith("https://") || trimmed.startsWith("http://")) {
    const url = new URL(trimmed);
    if (url.protocol !== "https:" || url.hostname.toLowerCase() !== "github.com") {
      throw new Error("Only HTTPS GitHub repository URLs are accepted.");
    }
    const parts = url.pathname.split("/").filter(Boolean);
    if (parts.length < 2) throw new Error("Provide a repository URL, not a profile URL.");
    slug = parts.slice(0, 2).join("/");
  }
  const parsed = slugSchema.safeParse(slug.replace(/\.git$/i, ""));
  if (!parsed.success) throw new Error("Use an owner/name slug or HTTPS github.com repository URL.");
  const [owner, name] = parsed.data.split("/");
  if (!owner || !name) throw new Error("Invalid repository identifier.");
  return { owner, name, fullName: owner + "/" + name };
}

async function githubRequest(path: string): Promise<Response> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "engineering-agent-readonly/0.1"
  };
  const token = process.env.GITHUB_TOKEN;
  if (token) headers.Authorization = "Bearer " + token;
  const response = await fetch("https://api.github.com" + path, {
    headers,
    signal: AbortSignal.timeout(12_000)
  });
  if (!response.ok) {
    if (response.status === 404) throw new Error("Repository/file not found, or the configured token cannot access it.");
    if (response.status === 401 || response.status === 403) throw new Error("GitHub access denied. Check token scope and API rate limits.");
    throw new Error("GitHub request failed with HTTP " + response.status + ".");
  }
  return response;
}

export async function inspectRepository(input: string, maxFiles = 100): Promise<RepositorySnapshot> {
  const repository = parseRepository(input);
  const owner = encodeURIComponent(repository.owner);
  const name = encodeURIComponent(repository.name);
  const metadataResponse = await githubRequest("/repos/" + owner + "/" + name);
  const metadata = await metadataResponse.json() as { description?: string | null; default_branch?: string; visibility?: string };
  const branch = metadata.default_branch;
  if (!branch) throw new Error("GitHub did not return a default branch. The repository may be empty.");

  const treeResponse = await githubRequest("/repos/" + owner + "/" + name + "/git/trees/" + encodeURIComponent(branch) + "?recursive=1");
  const treeText = await treeResponse.text();
  if (Buffer.byteLength(treeText, "utf8") > MAX_TREE_BYTES) throw new Error("Repository tree exceeded the safety limit.");
  const tree = JSON.parse(treeText) as { truncated?: boolean; tree?: Array<{ path: string; type: string; size?: number }> };
  const allFiles = (tree.tree ?? []).filter((entry) => entry.type === "blob");
  const paths = allFiles.slice(0, Math.max(1, Math.min(maxFiles, 200))).map((entry) => entry.path);
  let readme: string | null = null;
  const readmeEntry = allFiles.find((entry) => /^readme(?:\.md|\.rst|\.txt)?$/i.test(entry.path));
  if (readmeEntry && (readmeEntry.size ?? 0) <= MAX_FILE_BYTES) {
    try { readme = await readRepositoryFile(repository.fullName, readmeEntry.path, branch); }
    catch { readme = null; }
  }
  return {
    repository,
    description: metadata.description ?? null,
    defaultBranch: branch,
    visibility: metadata.visibility ?? "unknown",
    fileCount: allFiles.length,
    truncated: Boolean(tree.truncated) || allFiles.length > paths.length,
    paths,
    readme
  };
}

export async function readRepositoryFile(input: string, path: string, ref?: string): Promise<string> {
  const repository = parseRepository(input);
  const safePath = path.replace(/^\/+/, "");
  if (!safePath || safePath.split("/").some((part) => part === ".." || part === ".")) {
    throw new Error("Invalid repository file path.");
  }
  const query = ref ? "?ref=" + encodeURIComponent(ref) : "";
  const encodedPath = safePath.split("/").map(encodeURIComponent).join("/");
  const response = await githubRequest("/repos/" + encodeURIComponent(repository.owner) + "/" +
    encodeURIComponent(repository.name) + "/contents/" + encodedPath + query);
  const data = await response.json() as { type?: string; encoding?: string; content?: string; size?: number };
  if (data.type !== "file" || data.encoding !== "base64" || typeof data.content !== "string") {
    throw new Error("Requested path is not a regular text file.");
  }
  if ((data.size ?? Buffer.byteLength(data.content, "base64")) > MAX_FILE_BYTES) {
    throw new Error("File exceeds the " + MAX_FILE_BYTES + "-byte read limit.");
  }
  return Buffer.from(data.content.replace(/\n/g, ""), "base64").toString("utf8");
}
