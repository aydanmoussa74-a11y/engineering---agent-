# Engineering Agent

A ChatGPT-connected, permission-first engineering agent.

**Current capability baseline:** GitHub repository → inspect → evidence → engineering plan.

## Runtime modes

- **Local development:** the MCP server can run over stdio via `pnpm --filter @engineering-agent/mcp-server dev`.
- **Remote deployment:** the HTTP entrypoint uses MCP Streamable HTTP at `/mcp`, bearer-token authentication, and a Neon PostgreSQL database for durable project memory and task checkpoints.
- **Health check:** `/health` performs a database connectivity check.

The remote runtime does not enable shell execution, arbitrary command execution, repository writes, dependency installation, or automatic deployment. These capabilities require separate policy design, isolation and explicit approval.

## Requirements

- Node.js 20+
- pnpm 9+

## Development

~~~sh
pnpm install
pnpm --filter @engineering-agent/mcp-server dev
pnpm test
pnpm typecheck
~~~

For local HTTP development, set `DATABASE_URL` and `MCP_BEARER_TOKEN`, then run:

~~~sh
pnpm --filter @engineering-agent/mcp-server build
pnpm --filter @engineering-agent/mcp-server start
~~~

## Remote deployment environment

Set these as secret environment variables in the hosting provider:

- `DATABASE_URL`: Neon pooled connection string for application traffic.
- `MCP_BEARER_TOKEN`: long, random bearer token used by the MCP client.
- `AGENT_TENANT_ID`: fixed server-side tenant scope (default `primary`).
- `GITHUB_TOKEN`: optional fine-grained, read-only token for private repositories.
- `PUBLIC_HOST`: exact public hostname used for Host-header validation.
- `PORT`: supplied by Render.

Database schema is managed by versioned SQL files under `apps/mcp-server/migrations`. Apply migrations through the reviewed Neon migration workflow before deploying; the runtime verifies the required migration at startup and refuses to start if it is missing.

For private repositories, use a fine-grained token with read-only access to only the required repositories. Never commit tokens.

Repository files, comments, tool output and stored memory are untrusted data. They cannot override agent policy or grant permissions.
