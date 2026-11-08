import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";
import { lookup as dnsLookup } from "node:dns";

const MAX_BYTES = 1_000_000;
const MAX_REDIRECTS = 5;
const REQUEST_TIMEOUT_MS = 10_000;

function isPublicAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) {
    const parts = address.split(".").map(Number);
    const a = parts[0] ?? 0;
    const b = parts[1] ?? 0;
    const c = parts[2] ?? 0;
    if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
    if (a === 100 && b >= 64 && b <= 127) return false;
    if (a === 169 && b === 254) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && (b === 168 || (b === 0 && c === 0) || (b === 0 && c === 2))) return false;
    if (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) return false;
    if (a === 203 && b === 0 && c === 113) return false;
    return true;
  }
  if (family === 6) {
    const normalized = address.toLowerCase();
    if (normalized.startsWith("::ffff:")) return false;
    // Globally routable IPv6 unicast is within 2000::/3; exclude documentation space.
    return normalized.startsWith("2") || normalized.startsWith("3")
      ? !normalized.startsWith("2001:db8:")
      : false;
  }
  return false;
}

export function normalizeResearchTarget(value: string): URL {
  const url = new URL(value);
  if (url.protocol !== "https:") throw new Error("Only HTTPS research sources are allowed.");
  if (url.username || url.password) throw new Error("URLs with embedded credentials are not allowed.");
  if (url.port && url.port !== "443") throw new Error("Only the standard HTTPS port is allowed.");
  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (!hostname || hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".local")) {
    throw new Error("Local and private hostnames are not allowed.");
  }
  if (isIP(hostname)) throw new Error("IP-literal URLs are not allowed.");
  url.hash = "";
  return url;
}

async function resolvePinnedAddress(hostname: string): Promise<{ address: string; family: number }> {
  const records = await dnsLookup(hostname, { all: true, verbatim: true });
  if (!records.length || records.some((record) => !isPublicAddress(record.address))) {
    throw new Error("The hostname did not resolve exclusively to public IP addresses.");
  }
  const selected = records[0];
  if (!selected) throw new Error("The hostname has no usable address.");
  return { address: selected.address, family: selected.family };
}

function requestText(url: URL, address: string, family: number): Promise<{ status: number; location?: string; contentType: string; body: string }> {
  return new Promise((resolve, reject) => {
    const hostname = url.hostname;
    const request = httpsRequest(url, {
      method: "GET",
      agent: false,
      servername: hostname,
      headers: {
        "user-agent": "EngineeringAgentResearch/0.1 (+source-fetch)",
        accept: "text/html,text/plain,application/json,application/xml,application/xhtml+xml;q=0.9",
        "accept-encoding": "identity"
      },
      lookup: ((_host: string, _options: unknown, callback: (error: NodeJS.ErrnoException | null, address: string, family: number) => void) => {
        callback(null, address, family);
      }) as never
    }, (response) => {
      const status = response.statusCode ?? 0;
      const location = response.headers.location;
      const contentType = String(response.headers["content-type"] ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
      if (status >= 300 && status < 400 && location) {
        response.resume();
        resolve({ status, location, contentType, body: "" });
        return;
      }
      if (status < 200 || status >= 300) {
        response.resume();
        reject(new Error("Research source returned HTTP " + status + "."));
        return;
      }
      if (!["text/html", "text/plain", "application/json", "application/xml", "application/xhtml+xml"].includes(contentType)) {
        response.resume();
        reject(new Error("Research source returned a non-text content type."));
        return;
      }
      const chunks: Buffer[] = [];
      let total = 0;
      response.on("data", (chunk: Buffer | string) => {
        const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        total += bytes.length;
        if (total > MAX_BYTES) {
          request.destroy(new Error("Research source exceeded the 1 MB response limit."));
          return;
        }
        chunks.push(bytes);
      });
      response.on("end", () => resolve({ status, contentType, body: Buffer.concat(chunks).toString("utf8") }));
      response.on("error", reject);
    });
    request.setTimeout(REQUEST_TIMEOUT_MS, () => request.destroy(new Error("Research source request timed out.")));
    request.on("error", reject);
    request.end();
  });
}

export async function fetchPublicResearchText(input: string): Promise<{ finalUrl: string; status: number; contentType: string; body: string }> {
  let target = normalizeResearchTarget(input);
  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
    const pinned = await resolvePinnedAddress(target.hostname);
    const result = await requestText(target, pinned.address, pinned.family);
    if (!result.location) {
      return { finalUrl: target.toString(), status: result.status, contentType: result.contentType, body: result.body };
    }
    if (redirects === MAX_REDIRECTS) throw new Error("Research source exceeded the redirect limit.");
    target = normalizeResearchTarget(new URL(result.location, target).toString());
  }
  throw new Error("Research source redirect handling failed.");
}

export function extractResearchDocument(body: string, contentType: string): { title: string; excerpt: string } {
  if (contentType !== "text/html" && contentType !== "application/xhtml+xml") {
    return { title: "", excerpt: body.slice(0, 12_000) };
  }
  const title = (body.match(/<title\b[^>]*>([\s\S]*?)<\/title\s*>/i)?.[1] ?? "")
    .replace(/<[^>]*>/g, " ").replace(/&amp;/gi, "&").replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">")
    .replace(/\s+/g, " ").trim().slice(0, 500);
  const excerpt = body
    .replace(/<(script|style|noscript)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">")
    .replace(/\s+/g, " ").trim().slice(0, 12_000);
  return { title, excerpt };
}
