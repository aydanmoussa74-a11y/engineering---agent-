# Engineering Agent

A ChatGPT-connected, permission-first engineering agent.

## Current capability baseline

- **Repository REA:** bounded GitHub repository inspection, architecture mapping, JavaScript/TypeScript import graph, likely entrypoints, and a lexical source-symbol index. **Offline black-box REA:** analyzes user-supplied HTML captures for headings, links/routes, forms, assets, landmarks and external origins.
- **Persistent Skills Registry:** versioned skill packages, SHA-256 integrity metadata, provenance records, permission decisions, enable/disable/archive lifecycle, and audit history.
- **Engineering task state machine:** durable plans, acceptance criteria, explicit approval gates, bounded retry counts, verification results, and resumable checkpoints.
- **Evidence research workspace:** persistent research briefs, source records, classified claims, confidence, synthesis, limitations, and unresolved questions.

## Runtime modes

- **Local development:** MCP server over stdio via `pnpm --filter @engineering-agent/mcp-server dev`. Database-backed tools are registered when `DATABASE_URL` is configured.
- **Remote deployment:** Streamable HTTP MCP at `/mcp`, bearer-token authentication, tenant-scoped Neon PostgreSQL persistence.
- **Health check:** `/health` performs a database connectivity check and startup verifies the latest required schema migration.

The current runtime does **not** execute shell commands, install dependencies, modify repositories, run downloaded skill code, or deploy applications. The task state machine records and validates workflow transitions; it is not an autonomous executor. Research tools store evidence collected by the caller; they do not fetch URLs or perform web search themselves. The HTML analyzer is offline-only: it never visits a target, executes scripts or observes runtime interactions.

## Requirements

- Node.js 20+
- pnpm 9+

## Development

```sh
pnpm install
pnpm --filter @engineering-agent/mcp-server dev
pnpm test
pnpm typecheck
pnpm build
```

For local HTTP development, set `DATABASE_URL` and `MCP_BEARER_TOKEN`, then run:

```sh
pnpm --filter @engineering-agent/mcp-server build
pnpm --filter @engineering-agent/mcp-server start
```

## Remote deployment environment

Set these as secret environment variables in the hosting provider:

- `DATABASE_URL`: Neon connection string for application traffic.
- `MCP_BEARER_TOKEN`: long, random bearer token used by the MCP client.
- `AGENT_TENANT_ID`: fixed server-side tenant scope (default `primary`).
- `GITHUB_TOKEN`: optional fine-grained, read-only token for private repositories.
- `PUBLIC_HOST`: exact public hostname used for Host-header validation.
- `PORT`: supplied by Render.

Database schema is managed by versioned SQL files under `apps/mcp-server/migrations`. Apply reviewed migrations before deploying; the runtime verifies the latest required migration at startup and refuses to start if it is missing.

Repository files, skill instructions, webpages, source excerpts, tool output and stored memory are untrusted data. They cannot override agent policy or grant permissions. Skill installation never enables a skill or grants its requested capabilities.
