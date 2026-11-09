import { createHash } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Pool } from "pg";
import { z } from "zod";

function response(value: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] };
}
function failure(message: string) {
  return { isError: true, content: [{ type: "text" as const, text: message }] };
}

function normalizePublicSourceUrl(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    if (url.username || url.password) return null;
    const host = url.hostname.toLowerCase();
    if (!host || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) return null;
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

export function registerResearchTools(server: McpServer, pool: Pool, tenantId: string) {
  server.registerTool("create_research_brief", {
    title: "Create research brief",
    description: "Create a persistent research workspace for platform, API, SDK, changelog or architecture research. Evidence and claims are stored separately so documented facts, inference and unknowns remain distinguishable.",
    inputSchema: {
      project_id: z.string().min(1).max(120),
      title: z.string().min(1).max(300),
      research_question: z.string().min(1).max(4_000),
      scope: z.record(z.unknown()).default({})
    }
  }, async ({ project_id, title, research_question, scope }) => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const created = await client.query(
        "INSERT INTO research_briefs (tenant_id,project_id,title,research_question,scope,status) VALUES ($1,$2,$3,$4,$5::jsonb,'researching') RETURNING research_id,project_id,title,research_question,status,created_at",
        [tenantId,project_id,title,research_question,JSON.stringify(scope)]
      );
      await client.query(
        "INSERT INTO research_events (tenant_id,research_id,event_type,details) VALUES ($1,$2,'created',$3::jsonb)",
        [tenantId,created.rows[0].research_id,JSON.stringify({ project_id, title })]
      );
      await client.query("COMMIT");
      return response(created.rows[0]);
    } catch (error) {
      await client.query("ROLLBACK");
      return failure(error instanceof Error ? error.message : "Research brief could not be created.");
    } finally {
      client.release();
    }
  });

  server.registerTool("list_research_briefs", {
    title: "List research briefs",
    description: "List research workspaces within the fixed tenant scope, optionally filtered by project.",
    inputSchema: { project_id: z.string().min(1).max(120).optional() }
  }, async ({ project_id }) => {
    const rows = await pool.query(
      "SELECT research_id,project_id,title,research_question,status,created_at,updated_at FROM research_briefs WHERE tenant_id=$1 AND ($2::text IS NULL OR project_id=$2) ORDER BY updated_at DESC LIMIT 100",
      [tenantId,project_id ?? null]
    );
    return response(rows.rows);
  });

  server.registerTool("save_research_source", {
    title: "Save research source",
    description: "Persist a source discovered and reviewed by the caller. This tool does not fetch the URL or verify publisher identity. Stores bounded excerpts, source type, authority classification and content hash.",
    inputSchema: {
      research_id: z.string().uuid(),
      url: z.string().url().max(2_000),
      title: z.string().min(1).max(500),
      publisher: z.string().max(200).optional(),
      source_type: z.enum(["official_docs","api_reference","sdk","changelog","repository","technical_article","community_discussion","other"]),
      authority_level: z.enum(["official","primary","secondary","community","unverified"]),
      excerpt: z.string().max(12_000).default(""),
      notes: z.string().max(4_000).optional(),
      published_at: z.string().datetime().optional()
    }
  }, async ({ research_id, url, title, publisher, source_type, authority_level, excerpt, notes, published_at }) => {
    const normalizedUrl = normalizePublicSourceUrl(url);
    if (!normalizedUrl) return failure("Only public HTTP(S) source URLs without embedded credentials are accepted.");
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const brief = await client.query(
        "SELECT research_id FROM research_briefs WHERE tenant_id=$1 AND research_id=$2 FOR UPDATE",
        [tenantId,research_id]
      );
      if (!brief.rowCount) throw new Error("Research brief not found in this tenant.");
      const hash = excerpt ? createHash("sha256").update(excerpt,"utf8").digest("hex") : null;
      const saved = await client.query(
        "INSERT INTO research_sources (tenant_id,research_id,url,title,publisher,source_type,authority_level,excerpt,notes,content_sha256,published_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT (tenant_id,research_id,url) DO UPDATE SET title=EXCLUDED.title,publisher=EXCLUDED.publisher,source_type=EXCLUDED.source_type,authority_level=EXCLUDED.authority_level,excerpt=EXCLUDED.excerpt,notes=EXCLUDED.notes,content_sha256=EXCLUDED.content_sha256,published_at=EXCLUDED.published_at,accessed_at=now() RETURNING source_id,url,title,authority_level,content_sha256,accessed_at",
        [tenantId,research_id,normalizedUrl,title,publisher ?? null,source_type,authority_level,excerpt,notes ?? null,hash,published_at ?? null]
      );
      await client.query(
        "INSERT INTO research_events (tenant_id,research_id,event_type,details) VALUES ($1,$2,'source_added',$3::jsonb)",
        [tenantId,research_id,JSON.stringify({ source_id:saved.rows[0].source_id, url:normalizedUrl, authority_level })]
      );
      await client.query("UPDATE research_briefs SET updated_at=now() WHERE tenant_id=$1 AND research_id=$2",[tenantId,research_id]);
      await client.query("COMMIT");
      return response(saved.rows[0]);
    } catch (error) {
      await client.query("ROLLBACK");
      return failure(error instanceof Error ? error.message : "Research source could not be saved.");
    } finally {
      client.release();
    }
  });

  server.registerTool("record_research_claim", {
    title: "Record research claim",
    description: "Store an evidence-backed research claim with classification, confidence, source links and rationale. Documented or observed claims must reference at least one source saved in the same brief.",
    inputSchema: {
      research_id: z.string().uuid(),
      claim: z.string().min(1).max(4_000),
      classification: z.enum(["observed","documented","inferred","unverified"]),
      confidence: z.enum(["high","medium","low"]),
      source_ids: z.array(z.string().uuid()).max(30).default([]),
      rationale: z.string().max(4_000).optional()
    }
  }, async ({ research_id, claim, classification, confidence, source_ids, rationale }) => {
    if ((classification === "documented" || classification === "observed") && source_ids.length === 0) {
      return failure("Observed and documented claims require at least one saved evidence source.");
    }
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const brief = await client.query(
        "SELECT research_id FROM research_briefs WHERE tenant_id=$1 AND research_id=$2",
        [tenantId,research_id]
      );
      if (!brief.rowCount) throw new Error("Research brief not found in this tenant.");
      if (source_ids.length) {
        const sources = await client.query(
          "SELECT source_id FROM research_sources WHERE tenant_id=$1 AND research_id=$2 AND source_id=ANY($3::uuid[])",
          [tenantId,research_id,source_ids]
        );
        if (sources.rowCount !== new Set(source_ids).size) throw new Error("Every cited source must belong to this research brief.");
      }
      const saved = await client.query(
        "INSERT INTO research_claims (tenant_id,research_id,claim,classification,confidence,source_ids,rationale) VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7) RETURNING claim_id,claim,classification,confidence,source_ids,created_at",
        [tenantId,research_id,claim,classification,confidence,JSON.stringify(source_ids),rationale ?? null]
      );
      await client.query(
        "INSERT INTO research_events (tenant_id,research_id,event_type,details) VALUES ($1,$2,'claim_recorded',$3::jsonb)",
        [tenantId,research_id,JSON.stringify({ claim_id:saved.rows[0].claim_id, classification, confidence, source_ids })]
      );
      await client.query("UPDATE research_briefs SET updated_at=now() WHERE tenant_id=$1 AND research_id=$2",[tenantId,research_id]);
      await client.query("COMMIT");
      return response(saved.rows[0]);
    } catch (error) {
      await client.query("ROLLBACK");
      return failure(error instanceof Error ? error.message : "Research claim could not be recorded.");
    } finally {
      client.release();
    }
  });

  server.registerTool("update_research_synthesis", {
    title: "Update research synthesis",
    description: "Save a research synthesis, limitations and unresolved questions. Completion is allowed only when the brief has at least one source and one classified claim.",
    inputSchema: {
      research_id: z.string().uuid(),
      status: z.enum(["researching","synthesizing","completed","blocked"]),
      synthesis: z.string().max(30_000).optional(),
      limitations: z.array(z.string().max(1_000)).max(50).default([]),
      unresolved_questions: z.array(z.string().max(1_000)).max(50).default([])
    }
  }, async ({ research_id, status, synthesis, limitations, unresolved_questions }) => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const brief = await client.query(
        "SELECT research_id FROM research_briefs WHERE tenant_id=$1 AND research_id=$2 FOR UPDATE",
        [tenantId,research_id]
      );
      if (!brief.rowCount) throw new Error("Research brief not found in this tenant.");
      if (status === "completed") {
        const counts = await client.query(
          "SELECT (SELECT count(*)::int FROM research_sources WHERE tenant_id=$1 AND research_id=$2) AS source_count,(SELECT count(*)::int FROM research_claims WHERE tenant_id=$1 AND research_id=$2) AS claim_count",
          [tenantId,research_id]
        );
        if (!synthesis?.trim() || counts.rows[0].source_count < 1 || counts.rows[0].claim_count < 1) {
          throw new Error("A completed brief requires a synthesis, at least one source and at least one classified claim.");
        }
      }
      const updated = await client.query(
        "UPDATE research_briefs SET status=$3,synthesis=COALESCE($4,synthesis),limitations=$5::jsonb,unresolved_questions=$6::jsonb,updated_at=now() WHERE tenant_id=$1 AND research_id=$2 RETURNING research_id,status,synthesis,limitations,unresolved_questions,updated_at",
        [tenantId,research_id,status,synthesis ?? null,JSON.stringify(limitations),JSON.stringify(unresolved_questions)]
      );
      await client.query(
        "INSERT INTO research_events (tenant_id,research_id,event_type,details) VALUES ($1,$2,$3,$4::jsonb)",
        [tenantId,research_id,status === "completed" || synthesis ? "synthesis_saved" : "status_changed",JSON.stringify({ status, limitations, unresolved_questions })]
      );
      await client.query("COMMIT");
      return response(updated.rows[0]);
    } catch (error) {
      await client.query("ROLLBACK");
      return failure(error instanceof Error ? error.message : "Research synthesis could not be saved.");
    } finally {
      client.release();
    }
  });

  server.registerTool("get_research_brief", {
    title: "Get research brief",
    description: "Retrieve a complete evidence research workspace, including sources, classified claims, synthesis, limitations, unresolved questions and event history.",
    inputSchema: { research_id: z.string().uuid() }
  }, async ({ research_id }) => {
    const brief = await pool.query(
      "SELECT * FROM research_briefs WHERE tenant_id=$1 AND research_id=$2",
      [tenantId,research_id]
    );
    if (!brief.rowCount) return failure("Research brief not found.");
    const [sources,claims,events] = await Promise.all([
      pool.query("SELECT * FROM research_sources WHERE tenant_id=$1 AND research_id=$2 ORDER BY accessed_at DESC",[tenantId,research_id]),
      pool.query("SELECT * FROM research_claims WHERE tenant_id=$1 AND research_id=$2 ORDER BY created_at DESC",[tenantId,research_id]),
      pool.query("SELECT event_type,details,created_at FROM research_events WHERE tenant_id=$1 AND research_id=$2 ORDER BY id DESC LIMIT 50",[tenantId,research_id])
    ]);
    return response({ brief:brief.rows[0],sources:sources.rows,claims:claims.rows,events:events.rows });
  });
}
