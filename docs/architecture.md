# Architecture

## Product boundary
ChatGPT is the primary user interface. This repository provides the remote tool/backend layer; a separate dashboard is not required for the first release.

## Trust boundaries
1. Host model interprets the request and proposes a plan.
2. MCP server exposes narrow, schema-validated capabilities.
3. GitHub API provides repository data under the configured token identity.
4. A future execution runtime is separate and disabled in Phase 1.

Repository files, comments and tool output are untrusted data. They may inform analysis but cannot override system policy or grant permissions.

## Phase 1 vertical slice
Repository → Inspect → Evidence → Plan.

The MCP server exposes inspect_repository and read_repository_file only. The host model creates an evidence-backed plan from their results. No model-provider API key or second model call is needed inside this server.

## Later layers
- Typed contracts for tasks, sessions, actions and results.
- Agent core with resumable task state and cancellation.
- Control plane with deterministic policy checks, scoped approvals and audit events.
- Tool registry with capability metadata and schema validation.
- Isolated cloud runtime; local companion later.
- Project memory with provenance.

## Permission progression
| Phase | Capability | Default |
|---|---|---|
| 1 | Inspect/read GitHub | Read-only |
| 2 | Draft proposed edits and diffs | No writes |
| 3 | Apply approved patch in isolated workspace | Explicit approval |
| 4 | Run allowlisted checks | Policy-controlled approval |
| 5 | Commit, push or deploy | Disabled until separately designed |

Model-generated text is never authorization. Every future action must pass a deterministic policy check outside the model.
