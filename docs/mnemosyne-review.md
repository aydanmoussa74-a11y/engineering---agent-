# Mnemosyne Protocol review notes

Reviewed repository: https://github.com/aydanmoussa74-a11y/Mnemosyne-Protocol
Reviewed branch: main
Review purpose: identify safe, reusable agent-memory concepts; not a full security audit.

## Reusable engineering ideas

1. Typed memory blocks with lifecycle state and importance.
2. Source-aware retrieval with vector/graph paths and Reciprocal Rank Fusion.
3. Consolidation jobs that preserve links to source blocks.
4. Context packing under a token budget.
5. Sanitizing untrusted memory content before model-context rendering.
6. Provider adapters behind a common interface.

For this agent, the highest-value early feature is not a vector database. It is durable, provenance-bearing project/task memory with explicit scope and conflict handling.

## Implementation caveats observed

The repository's SECURITY_AUDIT.md describes tenant isolation as patched. The inspected current store implementation still has areas that need verification before reusing it in a multi-tenant service:

- EntityORM has a tenant_id column, but the inspected _persist_entity creation path does not explicitly set entity.tenant_id; the ORM default can therefore write the default namespace.
- RelationORM and EdgeORM definitions shown in store.py do not include tenant_id columns, despite the domain schemas carrying tenant_id.
- traverse_graph does not accept a tenant_id argument and traverses the shared in-memory relation maps.
- _entity_by_name is a single name-to-ID map; tenant-aware lookups need to be tested when two tenants use the same entity name.

These are code-review observations from the inspected revision, not a claim that an exploit has been demonstrated. The existing tests are useful, but they do not prove every graph/persistence isolation path.

## Decision

Do not import Mnemosyne as a runtime dependency in Phase 1. Reuse its concepts selectively after building focused tests for tenant boundaries, persistence reload, graph traversal, and prompt-injection handling. Keep agent policy and authorization separate from memory at all times.
