import { createHash } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Pool } from "pg";
import { z } from "zod";
import { analyzeCapturedWebSurface } from "./blackbox.js";
import { extractResearchDocument, fetchPublicResearchText } from "./research-fetch.js";

function response(value: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] };
}
function failure(message: string) {
  return { isError: true, content: [{ type: "text" as const, text: message }] };
}

export function registerResearchFetchTools(server: McpServer, pool: Pool, tenantId: string) {
  server.registerTool("fetch_research_source", {
    title: "Fetch and save research source",
    description: "Fetch a public HTTPS text source with DNS/IP validation, pinned public-address requests, redirect revalidation, time and response-size limits. Saves the extracted evidence to a research brief as unverified until the caller evaluates its authority.",
    inputSchema: {
      research_id: z.string().uuid(),
      url: z.string().url().max(2_000),
      source_type: z.enum(["official_docs", "api_reference", "sdk", "changelog", "repository", "technical_article", "community_discussion", "other"]).default("other")
    }
  }, async ({ research_id, url, source_type }) => {
    try {
      const fetched = await fetchPublicResearchText(url);
      const document = extractResearchDocument(fetched.body, fetched.contentType);
      const title = document.title || new URL(fetched.finalUrl).pathname.slice(0, 500) || new URL(fetched.finalUrl).hostname;
      const publisher = new URL(fetched.finalUrl).hostname.slice(0, 200);
      const hash = document.excerpt ? createHash("sha256").update(document.excerpt, "utf8").digest("hex") : null;
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const brief = await client.query(
          "SELECT research_id FROM research_briefs WHERE tenant_id=$1 AND research_id=$2 FOR UPDATE",
          [tenantId, research_id]
        );
        if (!brief.rowCount) throw new Error("Research brief not found in this tenant.");
        const saved = await client.query(
          "INSERT INTO research_sources (tenant_id,research_id,url,title,publisher,source_type,authority_level,excerpt,notes,content_sha256) VALUES ($1,$2,$3,$4,$5,$6,'unverified',$7,$8,$9) ON CONFLICT (tenant_id,research_id,url) DO UPDATE SET title=EXCLUDED.title,publisher=EXCLUDED.publisher,source_type=EXCLUDED.source_type,authority_level='unverified',excerpt=EXCLUDED.excerpt,notes=EXCLUDED.notes,content_sha256=EXCLUDED.content_sha256,accessed_at=now() RETURNING source_id,url,title,authority_level,content_sha256,accessed_at",
          [tenantId, research_id, fetched.finalUrl, title, publisher, source_type, document.excerpt, "Fetched automatically; HTTP status " + fetched.status + "; content type " + fetched.contentType + ". Publisher authority has not been verified.", hash]
        );
        await client.query(
          "INSERT INTO research_events (tenant_id,research_id,event_type,details) VALUES ($1,$2,'source_added',$3::jsonb)",
          [tenantId, research_id, JSON.stringify({ source_id: saved.rows[0].source_id, url: fetched.finalUrl, status: fetched.status, content_type: fetched.contentType })]
        );
        await client.query("UPDATE research_briefs SET updated_at=now() WHERE tenant_id=$1 AND research_id=$2", [tenantId, research_id]);
        await client.query("COMMIT");
        return response({ source: saved.rows[0], fetched: { status: fetched.status, content_type: fetched.contentType, characters: fetched.body.length }, authority: "unverified", next_step: "Review publisher identity and source authority before using this as documented evidence." });
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    } catch (error) {
      return failure(error instanceof Error ? error.message : "Research source fetch failed.");
    }
  });

  server.registerTool("analyze_live_html_surface", {
    title: "Analyze live HTML surface",
    description: "Fetch and inspect the current static HTML of a website the caller owns or is authorized to inspect. Uses the SSRF-hardened HTTPS fetcher. This is not a browser: JavaScript is not executed and interactive behavior is not observed.",
    inputSchema: {
      url: z.string().url().max(2_000),
      authorized_to_inspect: z.literal(true).describe("Confirm that the caller owns the site or has permission to inspect it.")
    }
  }, async ({ url }) => {
    try {
      const fetched = await fetchPublicResearchText(url);
      if (fetched.contentType !== "text/html" && fetched.contentType !== "application/xhtml+xml") {
        return failure("The target did not return HTML; received " + fetched.contentType + ".");
      }
      const report = analyzeCapturedWebSurface(fetched.body, fetched.finalUrl);
      return response({
        ...report,
        analysisMode: "live_http_static_html_snapshot",
        fetch: { status: fetched.status, final_url: fetched.finalUrl, content_type: fetched.contentType, characters: fetched.body.length },
        limitations: [
          ...report.limitations,
          "The server returned HTML over HTTPS, but no browser engine was used.",
          "Client-side JavaScript, hydration, authenticated pages, network calls, interaction states and runtime behavior were not executed or observed."
        ]
      });
    } catch (error) {
      return failure(error instanceof Error ? error.message : "Live HTML analysis failed.");
    }
  });
}
