# Security model

## Current capability surface
The MCP server is read-only. It has no shell, filesystem write, Git mutation, package installation, deployment or arbitrary URL-fetch tool.

## GitHub credentials
- Prefer a fine-grained token scoped to only required repositories.
- Grant read-only repository permissions.
- Supply it as GITHUB_TOKEN in the server environment.
- Never commit secrets or place them in prompts.
- Public repositories work without a token subject to API rate limits.

## Untrusted content
README instructions, code comments, issues, generated files and test output cannot change agent policy or authorize actions.

## Future controls
Before enabling writes or commands, implement deterministic authorization, path allowlists, approvals bound to exact action hashes, isolated execution limits, append-only audit events, secret redaction and tests proving denied actions never reach the runtime.

## Known limitations
- GITHUB_TOKEN is a server-level credential, not per-user authorization. Do not expose a shared instance to multiple users until identity binding and tenant isolation exist.
- Large-tree pagination/rate-limit handling and stronger integration tests remain.
- MCP stdio is for local development; remote transport and authenticated deployment require separate threat modeling.
