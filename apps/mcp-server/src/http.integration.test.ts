import { afterEach, describe, expect, it } from "vitest";
import { createServer as createNetServer, type AddressInfo } from "node:net";
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Pool } from "pg";

const DATABASE_URL = process.env.DATABASE_URL;
const enabled = Boolean(DATABASE_URL);

describe.skipIf(!enabled)("remote MCP HTTP integration", () => {
  let child: ChildProcess | undefined;
  let stderr = "";

  afterEach(async () => {
    if (!child) return;
    if (child.exitCode === null && child.signalCode === null) {
      const exited = once(child, "exit");
      child.kill("SIGTERM");
      await Promise.race([
        exited,
        new Promise((resolve) => setTimeout(resolve, 5_000))
      ]);
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    }
    child = undefined;
  });

  it("authenticates, initializes MCP, lists tools and persists memory/task checkpoints", async () => {
    const database = new Pool({ connectionString: DATABASE_URL });
    const initialMigration = await readFile(
      new URL("../migrations/001_initial_memory_and_tasks.sql", import.meta.url),
      "utf8"
    );
    const workflowMigration = await readFile(
      new URL("../migrations/002_skills_registry_and_execution.sql", import.meta.url),
      "utf8"
    );
    const researchMigration = await readFile(
      new URL("../migrations/003_evidence_research_workspace.sql", import.meta.url),
      "utf8"
    );
    await database.query(initialMigration);
    await database.query(workflowMigration);
    await database.query(researchMigration);

    const portProbe = createNetServer();
    await new Promise<void>((resolve, reject) => {
      portProbe.once("error", reject);
      portProbe.listen(0, "127.0.0.1", () => resolve());
    });
    const port = (portProbe.address() as AddressInfo).port;
    await new Promise<void>((resolve, reject) => portProbe.close((error) => error ? reject(error) : resolve()));

    const token = "ci-integration-token-with-more-than-thirty-two-characters";
    const tenant = "integration-" + randomUUID();
    const host = "127.0.0.1:" + port;
    const baseUrl = "http://" + host;

    child = spawn(process.execPath, ["--import", "tsx", "src/http.ts"], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        PORT: String(port),
        DATABASE_URL: DATABASE_URL!,
        MCP_BEARER_TOKEN: token,
        AGENT_TENANT_ID: tenant,
        PUBLIC_HOST: host
      },
      stdio: ["ignore", "pipe", "pipe"]
    });
    child.stderr?.on("data", (chunk: Buffer) => { stderr += chunk.toString("utf8"); });

    try {
      let healthy = false;
      for (let attempt = 0; attempt < 60; attempt += 1) {
        if (child.exitCode !== null) throw new Error("HTTP server exited before becoming ready. " + stderr);
        try {
          const response = await fetch(baseUrl + "/health");
          if (response.status === 200) {
            healthy = true;
            break;
          }
        } catch {
          // The child may still be opening its database pool and listening socket.
        }
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
      expect(healthy, "HTTP server should pass its database-backed health check. " + stderr).toBe(true);

      const unauthenticated = await fetch(baseUrl + "/mcp");
      expect(unauthenticated.status).toBe(401);

      async function sendMcp(
        body: Record<string, unknown>,
        sessionId?: string
      ): Promise<{ status: number; sessionId: string | null; body: Record<string, any> | null }> {
        const headers: Record<string, string> = {
          authorization: "Bearer " + token,
          "content-type": "application/json",
          accept: "application/json, text/event-stream"
        };
        if (sessionId) headers["mcp-session-id"] = sessionId;
        const response = await fetch(baseUrl + "/mcp", {
          method: "POST",
          headers,
          body: JSON.stringify(body)
        });
        const contentType = response.headers.get("content-type") ?? "";
        const raw = await response.text();
        let parsed: Record<string, any> | null = null;
        if (raw) {
          if (contentType.includes("text/event-stream")) {
            const data = raw.split("\n").filter((line) => line.startsWith("data: "))
              .map((line) => line.slice(6));
            if (data.length) parsed = JSON.parse(data[data.length - 1]!) as Record<string, any>;
          } else {
            parsed = JSON.parse(raw) as Record<string, any>;
          }
        }
        return {
          status: response.status,
          sessionId: response.headers.get("mcp-session-id"),
          body: parsed
        };
      }

      const initialized = await sendMcp({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-03-26",
          capabilities: {},
          clientInfo: { name: "engineering-agent-ci", version: "1.0.0" }
        }
      });
      expect(initialized.status).toBe(200);
      expect(initialized.sessionId).toBeTruthy();
      const sessionId = initialized.sessionId!;
      expect(initialized.body?.result?.serverInfo?.name).toBe("engineering-agent");

      const notification = await sendMcp({
        jsonrpc: "2.0",
        method: "notifications/initialized"
      }, sessionId);
      expect(notification.status).toBe(202);

      const tools = await sendMcp({
        jsonrpc: "2.0",
        id: 2,
        method: "tools/list"
      }, sessionId);
      expect(tools.status).toBe(200);
      const toolNames = (tools.body?.result?.tools ?? []).map((tool: { name: string }) => tool.name);
      expect(toolNames).toEqual(expect.arrayContaining([
        "inspect_repository",
        "map_repository_architecture",
        "read_repository_file",
        "save_project_memory",
        "search_project_memory",
        "save_task_checkpoint",
        "get_task_checkpoint",
        "validate_skill_package",
        "install_skill",
        "list_skills",
        "inspect_skill",
        "read_skill_instructions",
        "record_skill_permission_decisions",
        "enable_skill",
        "disable_skill",
        "archive_skill",
        "create_engineering_task",
        "record_task_approval",
        "advance_engineering_task",
        "get_engineering_task",
        "create_research_brief",
        "list_research_briefs",
        "save_research_source",
        "record_research_claim",
        "update_research_synthesis",
        "get_research_brief"
      ]));

      async function callTool(id: number, name: string, args: Record<string, unknown>) {
        const result = await sendMcp({
          jsonrpc: "2.0",
          id,
          method: "tools/call",
          params: { name, arguments: args }
        }, sessionId);
        expect(result.status).toBe(200);
        expect(result.body?.error, "MCP tool call should not return a protocol error").toBeUndefined();
        return result.body?.result;
      }

      const validatedSkill = await callTool(3, "validate_skill_package", {
        content: "---\nname: ci-sample-skill\nversion: 1.0.0\ndescription: CI validation sample\n---\n\nRead-only test skill."
      });
      const skillReport = JSON.parse(validatedSkill.content[0].text) as {
        valid: boolean;
        executionEnabled: boolean;
        permissionsGranted: string[];
      };
      expect(skillReport).toMatchObject({
        valid: true,
        executionEnabled: false,
        permissionsGranted: []
      });

      const installed = await callTool(4, "install_skill", {
        content: "---\nname: ci-sample-skill\nversion: 1.0.0\ndescription: CI validation sample\n---\n\nRead-only test skill.",
        requested_permissions: ["repository.read"],
        dependencies: ["typescript"],
        source_ref: "ci://sample-skill",
        publisher: "integration-test"
      });
      const installedSkill = JSON.parse(installed.content[0].text) as {
        installed: boolean;
        skill: { skill_id: string; status: string };
        enabled: boolean;
        permission_state: string;
      };
      expect(installedSkill).toMatchObject({
        installed: true,
        skill: { status: "installed" },
        enabled: false,
        permission_state: "pending_user_approval"
      });

      const inspected = await callTool(5, "inspect_skill", { skill_id: installedSkill.skill.skill_id });
      const inspectedData = JSON.parse(inspected.content[0].text) as { permissions: Array<{ approval_status: string }> };
      expect(inspectedData.permissions[0]?.approval_status).toBe("pending");

      const enabledBeforeApproval = await callTool(6, "enable_skill", { skill_id: installedSkill.skill.skill_id });
      expect(enabledBeforeApproval.isError).toBe(true);

      await callTool(7, "record_skill_permission_decisions", {
        skill_id: installedSkill.skill.skill_id,
        version: "1.0.0",
        decisions: [{ scope: "repository.read", decision: "approved" }],
        approved_by: "ci-integration-operator"
      });
      const enabled = await callTool(8, "enable_skill", { skill_id: installedSkill.skill.skill_id });
      const enabledData = JSON.parse(enabled.content[0].text) as { enabled: boolean; execution_enabled: boolean };
      expect(enabledData).toMatchObject({ enabled: true, execution_enabled: false });

      const taskId = "workflow-task-" + randomUUID();
      const createdTask = await callTool(9, "create_engineering_task", {
        task_id: taskId,
        project_id: "workflow-project",
        goal: "Verify the persistent engineering task state machine",
        plan: ["Inspect", "Implement", "Verify"],
        acceptance_criteria: ["All workflow transitions are persisted"],
        requires_approval: true,
        max_attempts: 2
      });
      const createdTaskData = JSON.parse(createdTask.content[0].text) as { status: string; approval_state: string };
      expect(createdTaskData).toMatchObject({ status: "awaiting_approval", approval_state: "pending" });

      await callTool(10, "record_task_approval", {
        task_id: taskId,
        decision: "approved",
        approved_by: "ci-integration-operator",
        note: "Integration test approval."
      });
      await callTool(11, "advance_engineering_task", {
        task_id: taskId,
        next_status: "executing",
        checkpoint: "Execution phase started.",
        current_step: "Implement",
        increment_attempt: true
      });
      await callTool(12, "advance_engineering_task", {
        task_id: taskId,
        next_status: "verifying",
        checkpoint: "Implementation checks are ready."
      });
      const prematureCompletion = await callTool(13, "advance_engineering_task", {
        task_id: taskId,
        next_status: "completed",
        checkpoint: "Attempted completion without acceptance evidence.",
        result: { acceptance_criteria_met: false }
      });
      expect(prematureCompletion.isError).toBe(true);

      await callTool(14, "advance_engineering_task", {
        task_id: taskId,
        next_status: "completed",
        checkpoint: "All acceptance criteria passed.",
        result: { acceptance_criteria_met: true, checks: ["workflow-state", "approval-gate"] }
      });
      const workflow = await callTool(15, "get_engineering_task", { task_id: taskId });
      const workflowData = JSON.parse(workflow.content[0].text) as {
        task: { status: string; attempt_count: number; approval_state: string };
        recent_events: Array<{ event_type: string }>;
      };
      expect(workflowData.task).toMatchObject({ status: "completed", attempt_count: 1, approval_state: "approved" });
      expect(workflowData.recent_events.map((event) => event.event_type)).toContain("state_transition");

      const research = await callTool(20, "create_research_brief", {
        project_id: "research-project",
        title: "MCP integration research",
        research_question: "What does the sample MCP endpoint expose?",
        scope: { targets: ["tools"], excluded: ["runtime execution"] }
      });
      const researchBrief = JSON.parse(research.content[0].text) as { research_id: string; status: string };
      expect(researchBrief.status).toBe("researching");

      const incompleteBrief = await callTool(21, "update_research_synthesis", {
        research_id: researchBrief.research_id,
        status: "completed",
        synthesis: "This should not complete without evidence."
      });
      expect(incompleteBrief.isError).toBe(true);

      const source = await callTool(22, "save_research_source", {
        research_id: researchBrief.research_id,
        url: "https://docs.example.test/mcp/reference",
        title: "MCP Reference",
        publisher: "Example Documentation",
        source_type: "api_reference",
        authority_level: "official",
        excerpt: "The endpoint exposes a bounded list of registered tools.",
        notes: "Synthetic fixture for integration testing."
      });
      const sourceRecord = JSON.parse(source.content[0].text) as { source_id: string; content_sha256: string };
      expect(sourceRecord.content_sha256).toMatch(/^[a-f0-9]{64}$/);

      const unsupportedClaim = await callTool(24, "record_research_claim", {
        research_id: researchBrief.research_id,
        claim: "An unsupported documented statement.",
        classification: "documented",
        confidence: "high",
        source_ids: []
      });
      expect(unsupportedClaim.isError).toBe(true);

      await callTool(23, "record_research_claim", {
        research_id: researchBrief.research_id,
        claim: "The synthetic reference describes a bounded tool list.",
        classification: "documented",
        confidence: "high",
        source_ids: [sourceRecord.source_id],
        rationale: "Directly supported by the saved source excerpt."
      });
      const savedSynthesis = await callTool(26, "update_research_synthesis", {
        research_id: researchBrief.research_id,
        status: "completed",
        synthesis: "The research fixture contains one documented claim backed by one saved reference.",
        limitations: ["Synthetic CI source; not evidence about a real service."],
        unresolved_questions: ["No live endpoint was inspected."]
      });
      expect(JSON.parse(savedSynthesis.content[0].text).status).toBe("completed");
      const fullResearch = await callTool(27, "get_research_brief", { research_id: researchBrief.research_id });
      const fullResearchData = JSON.parse(fullResearch.content[0].text) as {
        sources: Array<{ source_id: string }>;
        claims: Array<{ classification: string }>;
        brief: { status: string };
      };
      expect(fullResearchData).toMatchObject({
        brief: { status: "completed" },
        sources: [expect.objectContaining({ source_id: sourceRecord.source_id })],
        claims: [expect.objectContaining({ classification: "documented" })]
      });

      const projectId = "integration-project-" + randomUUID();
      const savedMemory = await callTool(28, "save_project_memory", {
        project_id: projectId,
        kind: "architecture_decision",
        content: "Integration test verifies repository architecture memory persistence.",
        source_ref: "ci://remote-mcp-integration",
        confidence: "observed"
      });
      expect(savedMemory?.isError).not.toBe(true);

      const searchedMemory = await callTool(29, "search_project_memory", {
        project_id: projectId,
        query: "repository architecture",
        limit: 5
      });
      const memoryRows = JSON.parse(searchedMemory.content[0].text) as Array<{ content: string; source_ref: string }>;
      expect(memoryRows).toEqual(expect.arrayContaining([
        expect.objectContaining({
          content: "Integration test verifies repository architecture memory persistence.",
          source_ref: "ci://remote-mcp-integration"
        })
      ]));

      const taskId = "integration-task-" + randomUUID();
      await callTool(30, "save_task_checkpoint", {
        task_id: taskId,
        project_id: projectId,
        goal: "Verify remote MCP persistence",
        status: "verifying",
        checkpoint: "Memory and task tools are connected to the test database."
      });
      const checkpoint = await callTool(31, "get_task_checkpoint", { task_id: taskId });
      const checkpointData = JSON.parse(checkpoint.content[0].text) as {
        task: { task_id: string; status: string };
        recent_events: Array<{ status: string }>;
      };
      expect(checkpointData.task).toMatchObject({ task_id: taskId, status: "verifying" });
      expect(checkpointData.recent_events[0]?.status).toBe("verifying");

      const closed = await fetch(baseUrl + "/mcp", {
        method: "DELETE",
        headers: {
          authorization: "Bearer " + token,
          "mcp-session-id": sessionId,
          accept: "application/json, text/event-stream"
        }
      });
      expect([200, 202]).toContain(closed.status);
    } finally {
      await database.end();
    }
  }, 45_000);
});
