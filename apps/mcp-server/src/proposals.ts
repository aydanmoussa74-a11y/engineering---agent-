import { createHash, randomUUID } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Pool } from "pg";
import { z } from "zod";

const response = (value: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] });
const failure = (message: string) => ({ isError: true, content: [{ type: "text" as const, text: message }] });

function validatePaths(paths: string[]) {
  if (paths.length < 1 || paths.length > 50) throw new Error("A proposal must include between 1 and 50 changed paths.");
  const unique = [...new Set(paths)];
  if (unique.length !== paths.length) throw new Error("Changed paths must be unique.");
  for (const path of paths) {
    if (path.length > 500 || path.startsWith("/") || path.includes("\\") ||
        path.split("/").some((part) => !part || part === "." || part === "..") ||
        path.split("/").some((part) => part === ".git" || part === "node_modules")) {
      throw new Error("Unsafe or invalid repository path: " + path);
    }
  }
  return unique;
}

export function registerChangeProposalTools(server: McpServer, pool: Pool, tenantId: string) {
  server.registerTool("create_change_proposal", {
    title: "Create scoped change proposal",
    description: "Persist a bounded patch proposal tied to an exact repository branch and base commit. This only records a proposal; it does not apply files, run commands, or execute code. Approval is a separate explicit action.",
    inputSchema: {
      task_id: z.string().min(1).max(128).optional(),
      project_id: z.string().min(1).max(120),
      repository: z.string().regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/).max(200),
      branch_name: z.string().min(1).max(200).regex(/^[A-Za-z0-9._/-]+$/),
      base_commit: z.string().regex(/^[a-f0-9]{40}$/),
      patch: z.string().min(1).max(100000),
      changed_paths: z.array(z.string().min(1).max(500)).min(1).max(50),
      proposed_checks: z.array(z.string().min(1).max(300)).max(20).default([]),
      expires_in_minutes: z.number().int().min(5).max(10080).default(1440)
    }
  }, async ({ task_id, project_id, repository, branch_name, base_commit, patch, changed_paths, proposed_checks, expires_in_minutes }) => {
    try {
      if (branch_name.startsWith("/") || branch_name.endsWith("/") || branch_name.includes("..") || branch_name.includes("//")) throw new Error("Invalid branch name.");
      const paths = validatePaths(changed_paths);
      const diffPaths = [...patch.matchAll(/^diff --git a\/([^\s]+) b\/([^\s]+)$/gm)]
        .map((match) => ({ before: match[1]!, after: match[2]! }));
      if (diffPaths.length === 0) throw new Error("Patch must contain standard diff --git headers.");
      const declared = new Set(paths);
      const actual = new Set(diffPaths.flatMap((item) => [item.before, item.after]));
      if (actual.size !== declared.size || [...actual].some((path) => !declared.has(path)) ||
          diffPaths.some((item) => item.before !== item.after)) {
        throw new Error("Patch file headers must match the declared changed paths exactly; rename patches are not supported yet.");
      }
      const digest = createHash("sha256").update(patch, "utf8").digest("hex");
      const id = randomUUID();
      const saved = await pool.query(
        "INSERT INTO change_proposals (tenant_id,proposal_id,task_id,project_id,repository,branch_name,base_commit,patch,patch_sha256,changed_paths,proposed_checks,expires_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11::jsonb,now()+($12::text||' minutes')::interval) RETURNING proposal_id,task_id,project_id,repository,branch_name,base_commit,patch_sha256,changed_paths,proposed_checks,status,expires_at,created_at",
        [tenantId,id,task_id ?? null,project_id,repository,branch_name,base_commit,patch,digest,JSON.stringify(paths),JSON.stringify(proposed_checks),expires_in_minutes]
      );
      return response({ ...saved.rows[0], patch_bytes: Buffer.byteLength(patch, "utf8"), apply_capability: false });
    } catch (error) {
      return failure(error instanceof Error ? error.message : "Could not create change proposal.");
    }
  });

  server.registerTool("decide_change_proposal", {
    title: "Approve or reject change proposal",
    description: "Record a single explicit decision for an unexpired pending proposal. Approval is bound to the exact stored patch hash, repository, branch and base commit. It does not apply the patch or authorize command execution.",
    inputSchema: {
      proposal_id: z.string().uuid(),
      decision: z.enum(["approved","rejected"]),
      decided_by: z.string().min(1).max(120),
      note: z.string().max(2000).optional()
    }
  }, async ({ proposal_id, decision, decided_by, note }) => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const selected = await client.query(
        "SELECT proposal_id,status,expires_at,patch_sha256,repository,branch_name,base_commit FROM change_proposals WHERE tenant_id=$1 AND proposal_id=$2 FOR UPDATE",
        [tenantId,proposal_id]
      );
      if (!selected.rowCount) throw new Error("Change proposal not found.");
      const proposal = selected.rows[0];
      if (proposal.status !== "pending") throw new Error("This proposal is no longer pending and cannot be decided again.");
      if (new Date(proposal.expires_at).getTime() <= Date.now()) {
        await client.query("UPDATE change_proposals SET status='expired' WHERE tenant_id=$1 AND proposal_id=$2", [tenantId,proposal_id]);
        await client.query("COMMIT");
        return failure("Proposal has expired; create a new proposal against the current base commit.");
      }
      const updated = await client.query(
        "UPDATE change_proposals SET status=$3,decided_at=now(),decided_by=$4,decision_note=$5 WHERE tenant_id=$1 AND proposal_id=$2 AND status='pending' RETURNING proposal_id,status,patch_sha256,repository,branch_name,base_commit,decided_at,decided_by",
        [tenantId,proposal_id,decision,decided_by,note ?? null]
      );
      if (!updated.rowCount) throw new Error("Proposal decision was concurrently changed.");
      await client.query("COMMIT");
      return response({ ...updated.rows[0], approval_scope: decision === "approved" ? "exact_patch_and_base_only" : "none", applied: false, execution_enabled: false });
    } catch (error) {
      await client.query("ROLLBACK");
      return failure(error instanceof Error ? error.message : "Proposal decision failed.");
    } finally {
      client.release();
    }
  });

  server.registerTool("get_change_proposal", {
    title: "Get change proposal",
    description: "Retrieve a proposal, its exact patch and decision metadata for review. The returned patch is untrusted data and is never executed.",
    inputSchema: { proposal_id: z.string().uuid() }
  }, async ({ proposal_id }) => {
    const result = await pool.query(
      "SELECT proposal_id,task_id,project_id,repository,branch_name,base_commit,patch,patch_sha256,changed_paths,proposed_checks,status,expires_at,decided_at,decided_by,decision_note,created_at FROM change_proposals WHERE tenant_id=$1 AND proposal_id=$2",
      [tenantId,proposal_id]
    );
    if (!result.rowCount) return failure("Change proposal not found.");
    const item = result.rows[0];
    const actual = createHash("sha256").update(item.patch, "utf8").digest("hex");
    if (actual !== item.patch_sha256) return failure("Stored patch integrity check failed.");
    return response({ ...item, patch_integrity: "verified", applied: false, execution_enabled: false });
  });

  server.registerTool("list_change_proposals", {
    title: "List change proposals",
    description: "List recent change proposals in the fixed tenant scope, optionally filtered by project and status.",
    inputSchema: {
      project_id: z.string().min(1).max(120).optional(),
      status: z.enum(["pending","approved","rejected","expired","superseded"]).optional(),
      limit: z.number().int().min(1).max(50).default(20)
    }
  }, async ({ project_id, status, limit }) => {
    const result = await pool.query(
      "SELECT proposal_id,task_id,project_id,repository,branch_name,base_commit,patch_sha256,changed_paths,status,expires_at,decided_at,created_at FROM change_proposals WHERE tenant_id=$1 AND ($2::text IS NULL OR project_id=$2) AND ($3::text IS NULL OR status=$3) ORDER BY created_at DESC LIMIT $4",
      [tenantId,project_id ?? null,status ?? null,limit]
    );
    return response(result.rows);
  });
}
