# Persistent execution and project memory

Status: required product capabilities; detailed persistence and runtime choices remain open.

## Persistent task lifecycle

A task must survive process restarts and interrupted conversations. Proposed lifecycle:

queued → investigating → planning → awaiting_approval → executing → verifying → completed

Additional states: paused, blocked, failed, cancelled.

Every transition records a timestamp, reason, task revision, and evidence pointer. The agent must be able to retrieve task status, resume eligible work, pause, and cancel.

## Execution loop

1. Re-read the task goal, acceptance criteria, current state, and latest checkpoint.
2. Select the next bounded action.
3. Check tool capability and policy.
4. Obtain any required task-scoped approval.
5. Execute in an isolated workspace with resource limits.
6. Capture outputs, changed files, exit codes, and logs with secret redaction.
7. Run relevant checks and inspect failures.
8. Diagnose and make bounded repairs within the approved scope.
9. Re-run verification after changes.
10. Persist a checkpoint and continue until acceptance criteria pass or a real blocker is reached.

The loop must not run indefinitely. It needs configurable time, token, tool-call, retry, and compute budgets; cancellation; idempotency; and explicit stop conditions. On budget exhaustion, preserve a resumable checkpoint.

## Approval boundaries

Approval is bound to a concrete action or diff and its scope. Material changes invalidate the affected approval. Require separate approval for consequential external side effects such as publishing, production deployment, destructive data changes, permission expansion, or paid resource creation. Never treat generated model text as approval.

## Verification standard

- Distinguish planned checks from executed checks.
- Record exact command/tool, environment, timestamp, exit status, and relevant output.
- Tests, build, static analysis, and end-to-end behaviour are separate claims.
- Do not report success unless fresh evidence proves the specific claim.
- If the environment cannot run a check, report it as unverified.

## Memory model

Use Mnemosyne-Protocol as a source of design ideas, not as an assumed runtime dependency.

Early memory should prioritise durable, typed, provenance-bearing records:
- Project facts and architecture observations.
- User-approved decisions and constraints.
- Task summaries, checkpoints, and outcomes.
- Known issues and verification evidence.
- Skill and tool usage metadata where useful.

Each record needs identity, scope, source/provenance, creation/update time, lifecycle, confidence or evidence class, and links to the relevant project/task/repository revision.

## Memory safety

- Memory is data, never policy or permission.
- Keep project, task, and user scopes separate.
- Enforce tenant and project boundaries in every read/write/query path.
- Preserve links to original evidence; do not promote inferred statements into facts during consolidation.
- Detect stale or conflicting memories and surface them rather than silently overwriting.
- Apply context budgets and retrieve narrowly by task relevance.
- Do not add vector/graph infrastructure until measured retrieval needs justify it.
