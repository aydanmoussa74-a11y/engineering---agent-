# Plugin, backend, and runtime delivery plan

Status: proposed architecture based on the user's approved direction. Deployment and plugin creation remain pending implementation and verification.

## User-facing surface

ChatGPT is the primary interface. A private ChatGPT plugin exposes the agent's tools. No separate dashboard is required for the first release.

## Backend responsibilities

The remote backend is responsible for:
- Authentication and identity binding.
- MCP tool registration and request validation.
- Task/session orchestration and durable state.
- Skills registry and selection.
- Research and REA coordination.
- Policy decisions, approval records, and audit events.
- Memory retrieval and persistence.
- Dispatch to isolated execution workspaces.

The model proposes and interprets; deterministic backend policy authorises.

## MCP tool families

Initial read-only tools:
- inspect_repository
- read_repository_file
- research_platform
- inspect_task / get_task_status

Later tools, after their contracts and controls exist:
- create_task / continue_task / pause_task / cancel_task
- propose_patch / inspect_diff
- run_approved_checks
- manage_skill operations
- apply_approved_patch
- commit_or_publish only behind separate explicit approval

Do not expose a generic unrestricted shell or arbitrary URL-fetch tool as the first execution interface.

## Runtime isolation

Use a disposable per-task workspace with:
- Explicit repository and branch scope.
- Read/write mount boundaries.
- Network policy and egress controls.
- CPU, memory, disk, process, and time limits.
- Secret isolation and redaction.
- Audit events and cleanup.
- No host-level or cross-task filesystem access.

The control plane and execution worker are separate trust domains.

## Deployment approach

- Use a dedicated Render web service for the agent backend; do not repurpose the existing OpenCode service without explicit approval.
- Start with a free-tier prototype only if its current capabilities and limits support the required transport, persistence, and uptime.
- Verify current Render constraints before committing to the design.
- Do not assume ephemeral service storage is durable task storage.
- Keep secrets in provider-managed environment variables, never in Git.
- If a required capability needs a paid plan, payment details, or upgrade, stop and present the blocker rather than accepting costs.

## Plugin connection

Create the private ChatGPT plugin only after:
1. Remote MCP transport is implemented.
2. Authentication and identity binding are tested.
3. The endpoint is deployed and reachable.
4. MCP tool discovery and representative calls are verified.
5. The plugin package references the exact verified endpoint, transport, and auth configuration.

A successful plugin upload does not prove that the backend works. Verify the tools after connection.

## Delivery milestones

1. Product/architecture contracts agreed.
2. Remote authenticated MCP and minimal task API.
3. REA + platform research vertical slice with evidence.
4. Skills registry read/validate/install/enable lifecycle.
5. Durable task state and resumable orchestration.
6. Isolated execution workspace and bounded approved edits.
7. Verification/repair loop and audit receipts.
8. Private plugin packaging, connection, and end-to-end validation.

Milestones should deliver complete user outcomes; do not claim the agent is fully capable after only the first tool integration.
