import { randomUUID } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Pool } from "pg";
import { z } from "zod";

const statuses = ["queued", "investigating", "planning", "awaiting_approval", "executing", "verifying", "completed", "paused", "blocked", "failed", "cancelled"] as const;
type TaskStatus = typeof statuses[number];

const transitions: Record<TaskStatus, TaskStatus[]> = {
  queued: ["investigating", "planning", "awaiting_approval", "cancelled"],
  investigating: ["planning", "awaiting_approval", "blocked", "failed", "paused", "cancelled"],
  planning: ["awaiting_approval", "executing", "blocked", "failed", "paused", "cancelled"],
  awaiting_approval: ["executing", "paused", "blocked", "cancelled"],
  executing: ["verifying", "awaiting_approval", "blocked", "failed", "paused"],
  verifying: ["completed", "executing", "blocked", "failed", "paused"],
  completed: [],
  paused: ["queued", "investigating", "planning", "executing", "cancelled"],
  blocked: ["investigating", "planning", "executing", "cancelled"],
  failed: ["queued", "investigating", "cancelled"],
  cancelled: []
};

function response(value: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] };
}
function failure(message: string) {
  return { isError: true, content: [{ type: "text" as const, text: message }] };
}

export function registerTaskTools(server: McpServer, pool: Pool, tenantId: string) {
  server.registerTool("create_engineering_task", {
    title: "Create engineering task",
    description: "Create a durable engineering workflow with a plan and acceptance criteria. Tasks requiring approval start paused at an approval gate. This state machine does not execute shell commands or modify repositories.",
    inputSchema: {
      task_id: z.string().min(1).max(128).optional(),
      project_id: z.string().min(1).max(120),
      goal: z.string().min(1).max(4_000),
      plan: z.array(z.string().min(1).max(1_000)).max(30).default([]),
      acceptance_criteria: z.array(z.string().min(1).max(1_000)).max(30).default([]),
      requires_approval: z.boolean().default(true),
      max_attempts: z.number().int().min(1).max(10).default(2)
    }
  }, async ({ task_id, project_id, goal, plan, acceptance_criteria, requires_approval, max_attempts }) => {
    const id = task_id ?? randomUUID();
    const status: TaskStatus = requires_approval ? "awaiting_approval" : "queued";
    const approvalState = requires_approval ? "pending" : "not_required";
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const saved = await client.query(
        "INSERT INTO agent_tasks (tenant_id,task_id,project_id,goal,status,checkpoint,plan,acceptance_criteria,max_attempts,approval_state) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9,$10) RETURNING *",
        [tenantId,id,project_id,goal,status,"Task created.",JSON.stringify(plan),JSON.stringify(acceptance_criteria),max_attempts,approvalState]
      );
      await client.query(
        "INSERT INTO task_events (tenant_id,task_id,status,checkpoint,event_type,metadata) VALUES ($1,$2,$3,$4,'created',$5::jsonb)",
        [tenantId,id,status,"Task created.",JSON.stringify({ plan, acceptance_criteria, requires_approval, max_attempts })]
      );
      await client.query("COMMIT");
      return response(saved.rows[0]);
    } catch (error) {
      await client.query("ROLLBACK");
      return failure(error instanceof Error ? error.message : "Task creation failed.");
    } finally {
      client.release();
    }
  });

  server.registerTool("record_task_approval", {
    title: "Record engineering task approval",
    description: "Record the user's explicit approval or rejection for a task currently waiting at an approval gate. Only an approved task may transition into execution.",
    inputSchema: {
      task_id: z.string().min(1).max(128),
      decision: z.enum(["approved", "rejected"]),
      approved_by: z.string().min(1).max(120),
      note: z.string().max(2_000).optional()
    }
  }, async ({ task_id, decision, approved_by, note }) => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const task = await client.query(
        "SELECT status,approval_state FROM agent_tasks WHERE tenant_id=$1 AND task_id=$2 FOR UPDATE",
        [tenantId,task_id]
      );
      if (!task.rowCount) throw new Error("Task not found.");
      if (task.rows[0].status !== "awaiting_approval") throw new Error("Task is not currently waiting for approval.");
      const updated = await client.query(
        "UPDATE agent_tasks SET approval_state=$3,checkpoint=$4,updated_at=now(),status=CASE WHEN $3='rejected' THEN 'blocked' ELSE status END,blocked_reason=CASE WHEN $3='rejected' THEN 'User rejected the requested operation.' ELSE NULL END WHERE tenant_id=$1 AND task_id=$2 RETURNING task_id,status,approval_state,updated_at",
        [tenantId,task_id,decision,note ?? "Approval decision recorded by " + approved_by + "."]
      );
      await client.query(
        "INSERT INTO task_events (tenant_id,task_id,status,checkpoint,event_type,metadata) VALUES ($1,$2,$3,$4,'approval_decision',$5::jsonb)",
        [tenantId,task_id,updated.rows[0].status,note ?? "Approval decision recorded.",JSON.stringify({ decision, approved_by })]
      );
      await client.query("COMMIT");
      return response(updated.rows[0]);
    } catch (error) {
      await client.query("ROLLBACK");
      return failure(error instanceof Error ? error.message : "Approval decision could not be recorded.");
    } finally {
      client.release();
    }
  });

  server.registerTool("advance_engineering_task", {
    title: "Advance engineering task",
    description: "Advance a durable task through validated workflow states, recording a checkpoint and optional verification result. Rejects illegal transitions and retry counts above the configured limit. This records orchestration state; it does not execute commands.",
    inputSchema: {
      task_id: z.string().min(1).max(128),
      next_status: z.enum(statuses),
      checkpoint: z.string().min(1).max(20_000),
      current_step: z.string().max(1_000).optional(),
      increment_attempt: z.boolean().default(false),
      result: z.record(z.unknown()).optional(),
      blocked_reason: z.string().max(2_000).optional()
    }
  }, async ({ task_id, next_status, checkpoint, current_step, increment_attempt, result: taskResult, blocked_reason }) => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const selected = await client.query(
        "SELECT * FROM agent_tasks WHERE tenant_id=$1 AND task_id=$2 FOR UPDATE",
        [tenantId,task_id]
      );
      if (!selected.rowCount) throw new Error("Task not found.");
      const current = selected.rows[0];
      const currentStatus = current.status as TaskStatus;
      if (!transitions[currentStatus]?.includes(next_status)) {
        throw new Error("Invalid task transition: " + currentStatus + " -> " + next_status + ".");
      }
      if (next_status === "executing" && current.approval_state === "pending") {
        throw new Error("Execution is blocked until the user explicitly approves this task.");
      }
      if (next_status === "executing" && current.approval_state === "rejected") {
        throw new Error("Execution is blocked because approval was rejected.");
      }
      const nextAttempt = Number(current.attempt_count) + (increment_attempt ? 1 : 0);
      if (nextAttempt > Number(current.max_attempts)) throw new Error("Configured retry limit reached.");
      if (next_status === "completed" && !taskResult) throw new Error("A verification result is required before completion.");
      const updated = await client.query(
        "UPDATE agent_tasks SET status=$3,checkpoint=$4,current_step=COALESCE($5,current_step),attempt_count=$6,result=COALESCE($7::jsonb,result),blocked_reason=$8,started_at=CASE WHEN $3='executing' AND started_at IS NULL THEN now() ELSE started_at END,completed_at=CASE WHEN $3='completed' THEN now() ELSE NULL END,updated_at=now() WHERE tenant_id=$1 AND task_id=$2 RETURNING *",
        [tenantId,task_id,next_status,checkpoint,current_step ?? null,nextAttempt,taskResult ? JSON.stringify(taskResult) : null,blocked_reason ?? null]
      );
      await client.query(
        "INSERT INTO task_events (tenant_id,task_id,status,checkpoint,event_type,metadata) VALUES ($1,$2,$3,$4,'state_transition',$5::jsonb)",
        [tenantId,task_id,next_status,checkpoint,JSON.stringify({ from: currentStatus, to: next_status, current_step: current_step ?? null, attempt_count: nextAttempt, blocked_reason: blocked_reason ?? null, result: taskResult ?? null })]
      );
      await client.query("COMMIT");
      return response(updated.rows[0]);
    } catch (error) {
      await client.query("ROLLBACK");
      return failure(error instanceof Error ? error.message : "Task transition failed.");
    } finally {
      client.release();
    }
  });

  server.registerTool("get_engineering_task", {
    title: "Get engineering task",
    description: "Retrieve the full durable task state, plan, acceptance criteria, approvals, verification result and recent event history.",
    inputSchema: { task_id: z.string().min(1).max(128) }
  }, async ({ task_id }) => {
    const task = await pool.query(
      "SELECT * FROM agent_tasks WHERE tenant_id=$1 AND task_id=$2",
      [tenantId,task_id]
    );
    if (!task.rowCount) return failure("Task not found.");
    const events = await pool.query(
      "SELECT status,checkpoint,event_type,metadata,created_at FROM task_events WHERE tenant_id=$1 AND task_id=$2 ORDER BY id DESC LIMIT 50",
      [tenantId,task_id]
    );
    return response({ task: task.rows[0], recent_events: events.rows });
  });
}
