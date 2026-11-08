# Persistent execution and project memory

Status: **durable task state machine and checkpoint persistence implemented**. The isolated execution backend, task-scoped change proposals, sandboxing and automated repair remain future work.

## Implemented task lifecycle

Tasks persist:
- Goal and project scope.
- Ordered plan and acceptance criteria.
- Status, current step and checkpoint.
- Approval state and decision history.
- Attempt count and configured retry ceiling.
- Block reason, verification result, start/completion timestamps.
- Append-only task event history with metadata.

MCP operations:
- `create_engineering_task`
- `record_task_approval`
- `advance_engineering_task`
- `get_engineering_task`
- Existing `save_task_checkpoint` and `get_task_checkpoint`

The transition tool validates legal state changes, blocks execution while approval is pending or rejected, enforces the retry limit, and requires explicit acceptance evidence before completion when acceptance criteria exist.

## Execution loop still required

The current state machine does **not** execute commands or edit repositories. Future execution work must add:
1. Re-read task goal, criteria, state and latest checkpoint.
2. Select a bounded next action and check tool permissions.
3. Obtain task-scoped approval for consequential actions.
4. Execute in an isolated workspace with resource limits.
5. Capture outputs, diffs, exit codes and redacted logs.
6. Run checks, diagnose failures and make bounded repairs.
7. Re-verify after changes and checkpoint progress.
8. Stop on acceptance, a real blocker, cancellation or exhausted budget.

The loop needs configurable time, tool-call, retry and compute budgets, idempotency, cancellation and resumability.

## Approval boundaries

Approval is bound to a concrete action or diff and its scope. Material changes invalidate affected approval. Publishing, production deployment, destructive data changes, permission expansion and paid resource creation require separate explicit approval. Generated model text is never approval.

## Verification standard

- Distinguish planned checks from executed checks.
- Record exact tool/check, environment, timestamp, exit status and relevant output.
- Tests, build, static analysis and end-to-end behaviour are separate claims.
- Do not report success unless fresh evidence proves the specific claim.
- If the environment cannot run a check, report it as unverified.

## Memory model

Project memory remains typed and provenance-bearing:
- Project facts and architecture observations.
- User-approved decisions and constraints.
- Task summaries, checkpoints and outcomes.
- Known issues and verification evidence.

Memory is data, never policy or permission. Tenant and project boundaries are enforced on read/write paths. Inferred statements must not silently become facts.
