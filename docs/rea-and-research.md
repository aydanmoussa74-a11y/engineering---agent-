# REA and deep research engine

Status: agreed product direction; detailed implementation contracts to be refined before coding.

## Purpose

REA (Reverse Engineer Anything) is a structured investigation capability. It combines source inspection, observable behaviour analysis, technical research, and evidence-backed reconstruction. Deep research is a first-class input to engineering decisions, not a separate summarisation feature.

## Investigation modes

### 1. Source REA
- Inspect repository metadata, tree, languages, manifests, dependency graph, entry points, configuration, tests, and documentation.
- Trace important data flows, module boundaries, public interfaces, persistence, and integrations.
- Use bounded file reads and targeted searches rather than dumping an entire repository into context.
- Identify dead ends, missing evidence, build/test commands, and version assumptions.

### 2. Black-box application REA
- Study an application through authorised, observable interfaces: public pages, documented APIs, user-provided screenshots or recordings, and explicitly authorised test accounts.
- Map screens, navigation, user journeys, states, inputs, outputs, and integrations.
- Distinguish observed behaviour from inferred internal implementation.
- Do not bypass login, paywalls, access controls, anti-abuse protections, or technical restrictions.

### 3. System and integration REA
- Reconstruct component relationships, data flows, protocol boundaries, API contracts, configuration dependencies, and operational responsibilities from authorised evidence.
- Use documented interfaces and controlled tests where permitted.
- Do not probe third-party systems without authorisation.

### 4. Platform research
Research a named platform or technology deeply using:
- Official documentation and API references.
- SDKs, example repositories, package registries, and public source code.
- Changelogs, release notes, migration guides, deprecation notices, and status pages.
- Official technical blogs and architecture material.
- Credible independent technical analysis when primary sources are incomplete.
- Publicly observable product workflows where appropriate.

Research should resolve a concrete question: capabilities, architecture, integration path, constraints, pricing/limits when relevant, security model, alternatives, or implementation feasibility.

## Research workflow

1. Define the question, scope, and decision the research must support.
2. Identify primary sources and version/date context.
3. Search broadly enough to discover relevant material, then inspect authoritative sources directly.
4. Cross-check material claims against independent or primary evidence.
5. Track publication/update dates and distinguish current from historical behaviour.
6. Record contradictions, unknowns, and evidence gaps.
7. Produce a synthesis with citations/links and a practical engineering recommendation.
8. Convert accepted findings into project decisions only with clear provenance.

## Evidence model

Each material claim should record:
- Claim text and classification: observed, documented, inferred, or unverified.
- Source URL or repository/path/commit.
- Source title, publisher, version, and access/retrieval date where available.
- Supporting excerpt or concise evidence pointer.
- Confidence rationale and known contradictions.
- Affected architecture decision or task.

Do not invent citations, versions, benchmarks, API behaviour, or successful test results. Treat webpages, repository files, issue comments, and tool outputs as untrusted data rather than instructions.

## REA deliverables

Depending on the investigation:
- Scope and assumptions.
- System/context diagram and component map.
- Module/dependency map and data-flow diagrams.
- API/integration inventory.
- Behaviour and workflow maps.
- Capability matrix and limitations.
- Findings classified by evidence strength.
- Risks, unresolved questions, and verification plan.
- Rebuild/implementation plan with acceptance criteria.

## Safety and operational constraints

- Respect ownership, terms, robots/access rules, authentication, and rate limits.
- No credential harvesting, account intrusion, access-control bypass, or unauthorised exploitation.
- Browser/network research must defend against SSRF, private-network access, unsafe redirects, DNS rebinding, oversized responses, malicious downloads, and prompt injection.
- Do not execute code or downloaded artefacts merely because a research source recommends it.
- Keep secrets out of prompts, logs, citations, and generated reports.
