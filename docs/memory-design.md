# Agent memory design

## Transferable ideas from Mnemosyne Protocol
- Typed memory records with IDs, timestamps, source, confidence and lifecycle.
- Provenance links to repository, commit, file path and line range.
- Hybrid retrieval: exact identifiers and lexical/metadata filters first; semantic retrieval later.
- Rank fusion such as Reciprocal Rank Fusion when multiple retrieval paths have incomparable scores.
- Consolidation that preserves links to original evidence.
- Context budgeting rather than injecting the full history.
- Prompt-injection awareness: memory is data, never executable policy.

## What not to copy blindly
Mnemosyne is a Python/SQLAlchemy/SQLite system; this agent is TypeScript-first. Porting the whole engine now would create coupling before access patterns are known.

The current implementation should also receive a focused audit before reuse. Some in-memory entity/relation maps and persistence helpers need tenant-scope verification as a unit; the security report's claims should be tested against the exact current code. Passing tests are evidence, not proof of complete isolation.

Autonomous consolidation must never promote an inferred or stale observation into an instruction or permission.

## Memory classes
| Kind | Example | Lifecycle |
|---|---|---|
| Project fact | Node 20; pnpm workspace | Until contradicted |
| Architecture decision | ChatGPT is the interface; MCP is the tool boundary | Durable, versioned |
| Task state | Inspect auth module before proposing a change | Session-scoped |
| Evidence | README path, commit SHA, line range | Durable pointer |
| Outcome | Tests passed on commit SHA X | Time-bound |
| Preference | Ask before writes | User-controlled |

Every record should carry id, scope, kind, content, source, createdAt and confidence, plus optional expiresAt. Verified facts require source references.

## Retrieval plan
1. Hard-filter by user, project and session scope.
2. Exact-match paths, symbols, IDs and task identifiers.
3. Lexical search.
4. Optional embeddings behind a provider-neutral interface after an evaluation set exists.
5. Use rank fusion only when multiple retrieval paths exist.
6. Return provenance with every result.

A knowledge graph is a later optimization, not a V1 requirement.

## Consolidation policy
- Draft candidate summaries; never delete raw evidence automatically.
- Preserve source links.
- Keep conflicting facts unresolved until verified.
- Expire stale task state.
- Never promote model guesses into verified facts.
- Require explicit policy for destructive retention.
