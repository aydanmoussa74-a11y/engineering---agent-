# Product vision and scope

Status: agreed direction; implementation decisions remain subject to the architecture review.

## Product promise

Build a ChatGPT-connected engineering agent that can deeply understand unfamiliar software and platforms, plan substantial engineering work, execute approved changes end to end, verify outcomes, and retain useful project context across sessions.

The agent is not a chat wrapper around a code generator. Its core loop is:

Understand → Research → Plan → Obtain authority → Execute → Verify → Learn → Continue.

## Primary user experience

- ChatGPT is the primary interface for requests, plans, approvals, progress, and results.
- The user can start a substantial task and return later without losing its state.
- The agent explains what it observed, what it inferred, what it changed, and what remains blocked.
- No separate dashboard is required for the first useful release. Operational status and task controls are exposed through MCP tools and chat.
- A future optional web interface may provide richer task timelines and skill management, but it is not a prerequisite.

## Core capability pillars

1. Reverse Engineer Anything (REA): inspect source repositories, authorised application behaviour, systems, interfaces, integrations, and technical platforms.
2. Deep Platform Research: research products and platforms from authoritative documentation, API references, SDKs, changelogs, public repositories, technical articles, and observable public behaviour.
3. Persistent Engineering Execution: carry approved tasks through implementation, checks, diagnosis, repair, and verification, with durable checkpoints and resumability.
4. Agent Skills Registry: discover, inspect, install, version, enable, disable, expose, and remove reusable skills with explicit capability boundaries.
5. Project Memory: preserve scoped decisions, architecture facts, task state, evidence, and provenance.
6. Safe Tooling: connect repositories, isolated workspaces, model providers, research sources, and other approved integrations.

## REA boundaries

REA means broad technical understanding, not unrestricted access. It may analyse systems and materials the user owns or is authorised to inspect, and publicly accessible material within applicable rules. It must not bypass authentication, defeat access controls, steal credentials, exploit third-party systems, or reproduce harmful capabilities.

## Non-goals for the first release

- A full IDE or code editor inside ChatGPT.
- An autonomous agent with unrestricted shell, network, repository, or deployment access.
- Silent production changes or unapproved publication.
- A vector database or graph database before retrieval needs justify it.
- A marketplace that blindly trusts arbitrary third-party skills.
- Claims that every possible system can be reconstructed perfectly.

## Completion standard

A task is complete only when its agreed acceptance criteria have fresh evidence. If the agent cannot complete it, it must report the exact blocker, evidence gathered, work performed, and the next safe action. A generated plan or code diff alone is not completion.
