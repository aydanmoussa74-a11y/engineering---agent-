import { randomUUID } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Pool } from "pg";
import { z } from "zod";

const API = "https://api.github.com";
const WORKFLOW = "omen-execution.yml";
const DEFAULT_WORKFLOW_REF = "main";
const PREFIX = "omen.execution.v1:";

type RunRecord = {
  kind: "github_actions_execution";
  task_id: string;
  repository: string;
  ref: string;
  workflow: string;
  request_id: string;
  dispatched_at: string;
  run_id?: number;
  run_url?: string;
};

function result(value: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] };
}
function fail(message: string) {
  return { isError: true, content: [{ type: "text" as const, text: message }] };
}
function parseRecord(checkpoint: string): RunRecord | null {
  if (!checkpoint.startsWith(PREFIX)) return null;
  try {
    const value = JSON.parse(checkpoint.slice(PREFIX.length)) as RunRecord;
    return value?.kind === "github_actions_execution" ? value : null;
  } catch {
    return null;
  }
}
function validateRef(ref: string) {
  if (ref.length > 200 || !/^[A-Za-z0-9._/-]+$/.test(ref) ||
      ref.startsWith("/") || ref.endsWith("/") || ref.includes("..") || ref.includes("//")) {
    throw new Error("Invalid Git ref.");
  }
}
async function githubRequest(token: string, path: string, init: RequestInit = {}) {
  const response = await fetch(API + path, {
    ...init,
    signal: AbortSignal.timeout(10_000),
    headers: {
      accept: "application/vnd.github+json",
      authorization: "Bearer " + token,
      "x-github-api-version": "2022-11-28",
      ...(init.body ? { "content-type": "application/json" } : {}),
      ...init.headers
    }
  });
  if (!response.ok && response.status !== 204) {
    const body = (await response.text()).slice(0, 1_000);
    throw new Error("GitHub Actions API returned HTTP " + response.status + (body ? ": " + body : "."));
  }
  return response.status === 204 ? null : response.json() as Promise<Record<string, any>>;
}

export function registerExecutionTools(server: McpServer, pool: Pool, tenantId: string) {
  server.registerTool("dispatch_engineering_verification", {
    title: "Dispatch approved engineering verification",
    description: "Dispatch the fixed, read-only GitHub Actions verification workflow for this configured repository. Requires an existing task in executing state with explicit approved approval_state. The workflow runs only typecheck, tests and build; it cannot accept arbitrary commands or repositories.",
    inputSchema: {
      task_id: z.string().min(1).max(128).regex(/^[A-Za-z0-9._:-]+$/),
      ref: z.string().min(1).max(200).default("main")
    }
  }, async ({ task_id, ref }) => {
    const repository = process.env.GITHUB_REPOSITORY ?? "";
    const token = process.env.GITHUB_ACTIONS_TOKEN ?? "";
    if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) {
      return fail("GITHUB_REPOSITORY is not configured as owner/name on the MCP service.");
    }
    if (token.length < 20) return fail("GITHUB_ACTIONS_TOKEN is not configured on the MCP service. Add it as a Render secret; never paste it into chat.");
    try {
      validateRef(ref);
      const task = await pool.query(
        "SELECT status,approval_state FROM agent_tasks WHERE tenant_id=$1 AND task_id=$2",
        [tenantId, task_id]
      );
      if (!task.rowCount) return fail("Task not found in this tenant.");
      if (task.rows[0].status !== "executing" || task.rows[0].approval_state !== "approved") {
        return fail("Dispatch requires the task to be in executing state with explicit approved approval_state.");
      }
      const recent = await pool.query(
        "SELECT status,checkpoint FROM task_events WHERE tenant_id=$1 AND task_id=$2 AND checkpoint LIKE $3 ORDER BY id DESC LIMIT 1",
        [tenantId, task_id, PREFIX + "%"]
      );
      if (recent.rowCount) {
        const previous = parseRecord(recent.rows[0].checkpoint);
        if (previous && ["queued", "in_progress"].includes(recent.rows[0].status)) {
          return fail("A verification run is already queued or running for this task. Check it before dispatching another.");
        }
      }
      const requestId = randomUUID();
      const dispatchedAt = new Date().toISOString();

      // workflow_dispatch must target the branch that contains the workflow file.
      // The requested code revision is a separate workflow input consumed by checkout.
      await githubRequest(token, "/repos/" + repository + "/actions/workflows/" + WORKFLOW + "/dispatches", {
        method: "POST",
        body: JSON.stringify({
          ref: DEFAULT_WORKFLOW_REF,
          inputs: { task_id, ref }
        })
      });

      const record: RunRecord = {
        kind: "github_actions_execution",
        task_id,
        repository,
        ref,
        workflow: WORKFLOW,
        request_id: requestId,
        dispatched_at: dispatchedAt
      };
      await pool.query(
        "INSERT INTO task_events (tenant_id,task_id,status,checkpoint) VALUES ($1,$2,'queued',$3)",
        [tenantId, task_id, PREFIX + JSON.stringify(record)]
      );
      return result({
        dispatched: true,
        run_status: "queued",
        task_id,
        repository,
        ref,
        workflow: WORKFLOW,
        workflow_ref: DEFAULT_WORKFLOW_REF,
        request_id: requestId,
        dispatched_at: dispatchedAt,
        note: "GitHub accepted the workflow dispatch request. Query get_engineering_execution for the run ID and final evidence."
      });
    } catch (error) {
      return fail(error instanceof Error ? error.message : "GitHub Actions dispatch failed.");
    }
  });

  server.registerTool("get_engineering_execution", {
    title: "Get engineering execution status",
    description: "Find the latest GitHub Actions verification run for a task and return its status, conclusion and evidence artifact metadata. Does not dispatch or modify a run.",
    inputSchema: { task_id: z.string().min(1).max(128) }
  }, async ({ task_id }) => {
    const token = process.env.GITHUB_ACTIONS_TOKEN ?? "";
    if (token.length < 20) return fail("GITHUB_ACTIONS_TOKEN is not configured on the MCP service.");
    const repository = process.env.GITHUB_REPOSITORY ?? "";
    if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) return fail("GITHUB_REPOSITORY is not configured as owner/name.");
    try {
      const saved = await pool.query(
        "SELECT status,checkpoint,created_at FROM task_events WHERE tenant_id=$1 AND task_id=$2 AND checkpoint LIKE $3 ORDER BY id DESC LIMIT 1",
        [tenantId, task_id, PREFIX + "%"]
      );
      if (!saved.rowCount) return fail("No GitHub Actions execution has been recorded for this task.");
      const record = parseRecord(saved.rows[0].checkpoint);
      if (!record) return fail("Stored execution record is invalid.");
      const workflowPath = encodeURIComponent(WORKFLOW);
      const runs = await githubRequest(
        token,
        "/repos/" + repository + "/actions/workflows/" + workflowPath + "/runs?event=workflow_dispatch&per_page=100"
      );
      const expectedTitle = "Omen task " + task_id;
      const candidates = Array.isArray(runs?.workflow_runs) ? runs.workflow_runs : [];
      const run = candidates.find((item: Record<string, any>) =>
        item.display_title === expectedTitle &&
        item.created_at >= record.dispatched_at
      );
      if (!run) {
        return result({
          task_id,
          run_status: saved.rows[0].status,
          dispatch: record,
          workflow_run: null,
          note: "Dispatch was accepted; GitHub has not exposed the matching workflow run yet. Retry shortly."
        });
      }
      const runRecord: RunRecord = { ...record, run_id: Number(run.id), run_url: String(run.html_url ?? "") };
      const status = run.status === "completed"
        ? (run.conclusion === "success" ? "completed" : "failed")
        : (run.status === "in_progress" ? "in_progress" : "queued");
      await pool.query(
        "INSERT INTO task_events (tenant_id,task_id,status,checkpoint) VALUES ($1,$2,$3,$4)",
        [tenantId, task_id, status, PREFIX + JSON.stringify(runRecord)]
      );
      const artifacts = await githubRequest(token, "/repos/" + repository + "/actions/runs/" + Number(run.id) + "/artifacts");
      return result({
        task_id,
        run_status: status,
        workflow_run: {
          id: run.id,
          name: run.name,
          display_title: run.display_title,
          status: run.status,
          conclusion: run.conclusion,
          head_sha: run.head_sha,
          head_branch: run.head_branch,
          created_at: run.created_at,
          updated_at: run.updated_at,
          html_url: run.html_url
        },
        artifacts: (artifacts?.artifacts ?? []).map((item: Record<string, any>) => ({
          name: item.name,
          size_in_bytes: item.size_in_bytes,
          expired: item.expired,
          expires_at: item.expires_at
        })),
        evidence_policy: "A successful workflow means typecheck, tests and build passed for the reported commit. It does not prove product acceptance or authorise repository writes."
      });
    } catch (error) {
      return fail(error instanceof Error ? error.message : "Could not retrieve GitHub Actions execution status.");
    }
  });
}
