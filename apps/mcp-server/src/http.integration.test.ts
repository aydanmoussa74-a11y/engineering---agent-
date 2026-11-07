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
    const migration = await readFile(
      new URL("../migrations/001_initial_memory_and_tasks.sql", import.meta.url),
      "utf8"
    );
    await database.query(migration);

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
            if (data.length) parsed = JSON.parse(data[data.length - 1]) as Record<string, any>;
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
        "get_task_checkpoint"
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

      const projectId = "integration-project-" + randomUUID();
      const savedMemory = await callTool(3, "save_project_memory", {
        project_id: projectId,
        kind: "architecture_decision",
        content: "Integration test verifies repository architecture memory persistence.",
        source_ref: "ci://remote-mcp-integration",
        confidence: "observed"
      });
      expect(savedMemory?.isError).not.toBe(true);

      const searchedMemory = await callTool(4, "search_project_memory", {
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
      await callTool(5, "save_task_checkpoint", {
        task_id: taskId,
        project_id: projectId,
        goal: "Verify remote MCP persistence",
        status: "verifying",
        checkpoint: "Memory and task tools are connected to the test database."
      });
      const checkpoint = await callTool(6, "get_task_checkpoint", { task_id: taskId });
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
