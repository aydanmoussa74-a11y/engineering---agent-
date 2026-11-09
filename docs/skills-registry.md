# Agent Skills Registry

Status: **first persistent registry foundation implemented**. External discovery and executable skill loading remain future work.

## Implemented operations

- `validate_skill_package`: validate flat YAML frontmatter, semantic version, description, dependency names and permission scopes; calculate SHA-256.
- `install_skill`: persist the SKILL.md content, manifest, version, hash, requested permissions and declared provenance.
- `list_skills`, `inspect_skill`, `read_skill_instructions`: inspect registry metadata and stored instructions.
- `record_skill_permission_decisions`: record explicit approved/rejected decisions for requested scopes.
- `enable_skill`, `disable_skill`, `archive_skill`: control registry availability and preserve an audit trail.

All records are tenant-scoped. Versions are immutable by name/version/hash: a different payload under an existing version is rejected.

## Trust and permission model

- Installation always leaves a skill in the `installed` state.
- Installing a skill does not enable it.
- Requested permissions begin as `pending`.
- A skill cannot be enabled while any requested permission is pending or rejected.
- Registry approval is not itself a runtime capability grant.
- Enabling a skill does not execute code or scripts.
- Archive is a soft uninstall: versions, content, hashes and audit history remain stored.
- Provenance fields are recorded as supplied; publisher authenticity is not yet verified.
- Skill instructions are untrusted data and cannot override host or user policy.

## Package contract and current limits

A package currently consists of one bounded `SKILL.md` file with flat frontmatter containing `name`, `version` and `description`. Dependencies and requested permission scopes are supplied as separate structured inputs.

Not yet implemented:
- External skill catalogs and trusted publisher verification.
- Multi-file archives, reference assets and path traversal checks for archive extraction.
- Dependency resolution and compatibility checks against runtime versions.
- Version pinning/rollback UI and skill selection telemetry.
- Loading skills into a live agent execution context.
- Runtime capability grants and isolation.

The registry deliberately separates metadata installation, permission decisions, enablement and execution.
