# Agent Skills Registry

Status: required product capability; implementation contracts to be finalised before coding.

## Purpose

Provide a first-class registry for reusable agent skills. A skill is a versioned capability package containing instructions, references, templates, and optionally declared tool requirements. Installing a skill must not grant it unrestricted authority.

## User capabilities

- Discover available built-in, user-provided, and trusted external skills.
- Inspect a skill's complete manifest, instructions, references, provenance, version, and declared capabilities before installation.
- Install from an approved source or local/package upload.
- Validate structure, references, manifest fields, and declared dependencies.
- Enable, disable, update, pin a version, uninstall, and inspect history.
- Expose selected skills to the agent for relevant tasks.
- See which skills were selected for a task and why.

## Skill package contract

A skill package should declare:
- Stable name and semantic version.
- Human-readable purpose and invocation conditions.
- Source/provenance and integrity metadata.
- Required tools/capabilities, if any.
- Compatible agent/runtime version.
- Entry instructions and contained references/assets.
- Optional dependencies and validation status.

## Trust and permission model

- Skill text is untrusted guidance, never system policy or authorisation.
- Installing a skill does not automatically enable it.
- Enabling a skill does not automatically grant its requested tools.
- Each tool capability is granted separately through the control plane.
- High-impact actions still require task-scoped approval.
- Skills cannot alter their own permission grants or suppress audit records.
- Unknown or third-party sources are labelled untrusted until reviewed.
- Pin versions for reproducibility; updates are explicit and reviewable.
- Disabling a skill prevents future selection; active tasks record the version they already loaded.

## Registry operations

Initial MCP-facing operations to consider:
- list_skills
- inspect_skill
- install_skill
- enable_skill
- disable_skill
- update_skill
- uninstall_skill
- list_skill_sources
- validate_skill

Mutating registry operations require authenticated ownership and explicit confirmation where appropriate. Tool schemas and exact approval rules are part of the next implementation design.

## Exposure and selection

The agent may select enabled skills based on task intent, repository context, and declared compatibility. It should load only relevant instructions and references, show the selected skill set in task evidence, and explain conflicts. A skill may suggest a workflow but cannot override host policy, user approval, or deterministic authorization.

## Security checks

- Validate archive paths and reject traversal, symlinks escaping the package, oversized files, and malformed manifests.
- Keep package contents isolated from secrets and runtime credentials.
- Treat skill instructions and reference documents as prompt-injection-capable content.
- Validate declared tools against a central capability registry.
- Record install/update/enable/disable/uninstall events.
- Provide a safe disable/revoke path.
