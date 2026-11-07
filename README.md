# Engineering Agent

A ChatGPT-connected, permission-first engineering agent.

**Phase 1 vertical slice:** GitHub repository → inspect → evidence → engineering plan.

The current MCP server is read-only. It does not expose shell execution, file mutation, dependency installation, Git pushes, or deployment.

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

The server uses MCP stdio transport. Build it before configuring a host to launch node with apps/mcp-server/dist/index.js.

For private repositories, set GITHUB_TOKEN in the server environment. Use a fine-grained token with read-only access to only the required repositories. Never commit tokens.

See docs/architecture.md, docs/memory-design.md and docs/security.md.
