import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

type AttributeMap = Record<string, string>;

function decodeEntities(value: string): string {
  return value
    .replace(/&amp;/gi, "&").replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'").replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">").replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)));
}

function attributes(tag: string): AttributeMap {
  const result: AttributeMap = {};
  const body = tag.replace(/^<\/?[\w:-]+/, "").replace(/\/?\s*>$/, "");
  const pattern = /([\w:-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>\x60]+)))?/g;
  for (const match of body.matchAll(pattern)) {
    const key = match[1]?.toLowerCase();
    if (key) result[key] = decodeEntities(match[2] ?? match[3] ?? match[4] ?? "");
  }
  return result;
}

function cleanText(value: string, limit = 300): string {
  return decodeEntities(value.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim()).slice(0, limit);
}

function safeSourceUrl(value?: string): URL | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) return null;
    return url;
  } catch { return null; }
}

/**
 * Analyze a user-supplied HTML capture. This is deliberately offline:
 * it never opens URLs, executes scripts, loads assets, or visits a live site.
 */
export function analyzeCapturedWebSurface(html: string, sourceUrl?: string) {
  if (html.length > 500_000) throw new Error("HTML capture exceeds the 500 KB character limit.");
  const base = safeSourceUrl(sourceUrl);
  const tags = html.match(/<[a-zA-Z][^>]{0,4000}>/g) ?? [];
  const title = cleanText(html.match(/<title\b[^>]*>([\s\S]*?)<\/title\s*>/i)?.[1] ?? "", 500);
  const description = decodeEntities(html.match(/<meta\b(?=[^>]*\bname\s*=\s*["']description["'])(?=[^>]*\bcontent\s*=\s*["']([^"']*)["'])[^>]*>/i)?.[1] ?? "").slice(0, 1000);
  const headings: Array<{ level: number; text: string }> = [];
  for (const match of html.matchAll(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1\s*>/gi)) {
    headings.push({ level: Number(match[1]), text: cleanText(match[2] ?? "", 300) });
    if (headings.length >= 100) break;
  }
  const links: Array<{ text: string; href: string; relation: string }> = [];
  const forms: Array<{ action: string; method: string; fields: Array<{ name: string; type: string; required: boolean }> }> = [];
  const images: Array<{ alt: string; src: string }> = [];
  const scripts: string[] = [];
  const stylesheets: string[] = [];
  const landmarks = new Set<string>();
  const externalOrigins = new Set<string>();

  for (const tag of tags) {
    const name = tag.match(/^<([\w:-]+)/)?.[1]?.toLowerCase() ?? "";
    const attr = attributes(tag);
    if (attr.role) landmarks.add(attr.role);
    if (["main", "nav", "header", "footer", "aside", "section"].includes(name)) landmarks.add(name);
    if (name === "a" && attr.href && links.length < 200) {
      let href = attr.href;
      try {
        const resolved = base ? new URL(href, base) : null;
        if (resolved) {
          href = resolved.toString();
          if (base && resolved.origin !== base.origin) externalOrigins.add(resolved.origin);
        }
      } catch { /* retain the literal href as supplied */ }
      links.push({ text: attr["aria-label"] ?? attr.title ?? "", href: href.slice(0, 2000), relation: attr.rel ?? "link" });
    }
    if (name === "img" && images.length < 100) images.push({ alt: attr.alt ?? "", src: (attr.src ?? attr["data-src"] ?? "").slice(0, 2000) });
    if (name === "script" && attr.src && scripts.length < 100) scripts.push(attr.src.slice(0, 2000));
    if (name === "link" && /stylesheet/i.test(attr.rel ?? "") && attr.href && stylesheets.length < 100) stylesheets.push(attr.href.slice(0, 2000));
    if (name === "form" && forms.length < 30) forms.push({ action: attr.action ?? "", method: (attr.method ?? "get").toLowerCase(), fields: [] });
    if (["input", "select", "textarea", "button"].includes(name) && forms.length && forms[forms.length - 1]!.fields.length < 50) {
      const fieldType = name === "input" ? (attr.type ?? "text").toLowerCase() : name;
      forms[forms.length - 1]!.fields.push({ name: attr.name ?? attr["aria-label"] ?? "", type: fieldType, required: "required" in attr });
    }
  }

  const routeCandidates = [...new Set(links.map((item) => {
    try { const u = new URL(item.href, base ?? "https://capture.invalid"); return u.pathname; } catch { return ""; }
  }).filter(Boolean))].slice(0, 100);

  return {
    analysisMode: "offline_user_supplied_capture",
    source: base ? { origin: base.origin, path: base.pathname } : null,
    document: { title, description, htmlCharacters: html.length },
    headings,
    links,
    routeCandidates,
    forms,
    images,
    scripts,
    stylesheets,
    landmarks: [...landmarks].sort(),
    externalOrigins: [...externalOrigins].sort(),
    evidence: [
      { claim: "The listed elements and attributes were present in the supplied HTML capture.", classification: "observed", confidence: "high" },
      { claim: "Route candidates were derived from captured anchor href attributes.", classification: "inferred", confidence: "medium" }
    ],
    limitations: [
      "This is a static snapshot, not a live-site inspection; client-rendered or interaction-only content may be absent.",
      "Scripts are listed but never executed. Network requests, API behavior, authentication, state transitions and runtime errors are not observed.",
      "The lightweight HTML scanner is not a standards-compliant DOM parser; malformed markup and unusual attribute syntax may be missed.",
      "Relative links are resolved only when a valid source URL is supplied. No URL is fetched or contacted."
    ]
  };
}

export function registerBlackBoxTools(server: McpServer) {
  server.registerTool("analyze_captured_web_surface", {
    title: "Analyze captured web surface",
    description: "Perform offline black-box REA on a user-supplied HTML snapshot from a site they own or are authorized to inspect. Extracts headings, links/routes, forms, assets, landmarks and external origins. Does not fetch URLs, execute scripts, authenticate, or contact the target.",
    inputSchema: {
      html: z.string().min(1).max(500_000).describe("HTML source or saved page snapshot, maximum 500 KB."),
      source_url: z.string().url().max(2_000).optional().describe("Optional public page URL used only to resolve captured relative links; it is never fetched.")
    }
  }, async ({ html, source_url }) => {
    try {
      return { content: [{ type: "text", text: JSON.stringify(analyzeCapturedWebSurface(html, source_url), null, 2) }] };
    } catch (error) {
      return { isError: true, content: [{ type: "text", text: error instanceof Error ? error.message : "Capture analysis failed." }] };
    }
  });
}
