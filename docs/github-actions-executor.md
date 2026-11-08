# GitHub Actions execution provider

Status: **runner workflow scaffold added; remote dispatch and durable run reconciliation are not yet active**.

## What the workflow does

`.github/workflows/omen-execution.yml` provides a fixed, bounded verification job on a fresh GitHub-hosted Ubuntu runner:

- Checks out only a revision from this repository.
- Uses Node.js 20 and the repository-pinned pnpm version.
- Runs only the fixed commands `pnpm typecheck`, `pnpm test` and `pnpm build`.
- Has a 15-minute job timeout.
- Grants only `contents: read`; checkout does not persist credentials.
- Does not receive Render, Neon, MCP, GitHub PAT or other application secrets.
- Produces a small JSON evidence artifact retained for seven days.

The workflow never accepts a shell command, arbitrary script, external repository URL, deployment target or secret as an input. A task identifier is trace metadata, not authority.

## Important GitHub constraint

GitHub only accepts `workflow_dispatch` for a workflow file that exists on the repository's **default branch**. This workflow is being developed on the feature branch and will not become remotely dispatchable until it is reviewed and merged into `main`. The existing pull request remains a draft; it has not been merged.

## Remaining integration

The MCP service still needs a least-privilege GitHub credential stored directly as a Render secret (never pasted into chat) to dispatch the workflow and query run results. The credential must have Actions write/dispatch permission scoped to this repository. The service also needs a durable run record and reconciliation path before it can safely report a task as executed or verified.

No credential has been configured or generated in this change. No workflow was dispatched. No task is reported as executed. The existing Neon schema was not changed.

## Trust boundary

GitHub-hosted runners are ephemeral hosted VMs, not a hardened multi-tenant sandbox guarantee for arbitrary hostile code. This initial workflow is restricted to verification of this repository's own revisions, uses no application secrets, grants read-only repository access, and runs a fixed command set. Do not use it as a general arbitrary-code execution service. A stronger sandbox provider remains necessary before broad REA or autonomous repair against untrusted repositories.

## Cost

The workflow uses GitHub-hosted standard runners. For a public repository, standard hosted runner usage is free under GitHub Actions' public-repository policy. No Render plan change or Neon paid feature is required by this workflow.
