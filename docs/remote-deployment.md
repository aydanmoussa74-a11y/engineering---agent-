# Remote MCP deployment

## Target topology

- Render Free web service runs the TypeScript MCP HTTP runtime.
- Neon PostgreSQL stores project memory and task checkpoints.
- GitHub holds source code and versioned SQL migrations.
- ChatGPT connects to the authenticated MCP endpoint.

The Render filesystem is not used for durable state. Application traffic uses Neon's pooled connection string.

## Endpoint and security

- MCP endpoint: `/mcp` using Streamable HTTP.
- Health endpoint: `/health` (checks database connectivity).
- MCP requests require an Authorization Bearer token.
- Host header is checked against `PUBLIC_HOST`.
- Fixed-window request rate limiting applies to the authenticated bearer credential; it does not trust caller-supplied forwarding headers for identity.
- MCP sessions are bounded and idle sessions are closed after 30 minutes.
- The tenant scope is fixed by server-side `AGENT_TENANT_ID`; clients cannot select another tenant.
- Repository inspection remains read-only. Shell execution, arbitrary commands, writes, package installation and deployment are not enabled.

## Database

Apply the SQL migration in `apps/mcp-server/migrations` through the reviewed Neon migration workflow before deploying the service. The runtime refuses to start if the required migration is missing. Migrations are not applied automatically at application startup.

The first schema contains:
- `memory_records`: typed, provenance-bearing project memory with full-text search.
- `agent_tasks`: latest resumable task checkpoint.
- `task_events`: append-only checkpoint history.
- `schema_migrations`: applied migration ledger.

## Render environment

Configure the following values as service secrets/environment variables:

- `DATABASE_URL`: Neon pooled connection string for `agentdb`.
- `MCP_BEARER_TOKEN`: randomly generated secret, at least 32 characters.
- `AGENT_TENANT_ID`: fixed tenant identifier.
- `PUBLIC_HOST`: exact Render hostname.
- `GITHUB_TOKEN`: optional fine-grained read-only token for private repositories.

Do not place secrets in Git, build logs, tool descriptions or public documentation.

## Verification checklist

1. CI typecheck, tests and build pass on the deployment branch.
2. Neon migration is tested on an isolated branch and explicitly applied to the dedicated project.
3. Render deploy uses the intended branch and Free plan.
4. `/health` returns HTTP 200 with database connected.
5. Unauthenticated `/mcp` requests return HTTP 401.
6. Authenticated MCP initialization, tool listing, memory write/search and task save/load work.
7. No pre-existing Render service or unrelated Neon project is modified.
