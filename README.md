# Senku

**A small, typed decision service for [Kaseki-Agent](https://github.com/CyanAutomation/kaseki-agent) and [Soyuz](https://github.com/CyanAutomation/soyuz).**

Senku is a planned, independently deployable [Cloudflare Worker](https://developers.cloudflare.com/workers/) that provides bounded, evidence-based classifications and scores through [OpenRouter's Decisions API](https://openrouter.ai/) and JEV. It centralises decision-provider integration, validation, versioned decision profiles, cost controls, and operational telemetry while leaving execution and policy enforcement with its callers.

- **Repository:** [CyanAutomation/senku](https://github.com/CyanAutomation/senku)
- **Planned deployment:** [senku.scheimann.workers.dev](https://senku.scheimann.workers.dev)
- **Runtime:** Cloudflare Workers, with the Workers Free plan as the initial operating target
- **Language:** Native TypeScript, using Web APIs and minimal dependencies
- **Interfaces:** Versioned REST API, OpenAPI, and [UTCP](https://www.utcp.io/) discovery
- **Decision provider:** JEV through OpenRouter's Decisions API (initial provider)

> **Project status: design / pre-implementation.** This README defines the intended architecture and proposed v1 API, **not** a list of working features. Senku has not yet been deployed to the planned hostname. The contracts below may evolve during implementation.

## Why Senku?

Kaseki-Agent and Soyuz currently implement related but separate JEV integrations:

- **Kaseki-Agent** uses typed decisions for task admission, goal checking, run evaluation, validation recovery, context routing, and scouting-to-coding phase transfer.
- **Soyuz** uses JEV for advisory run-operations triage and recorded-outcome reviews in its authenticated analysis dashboard.

Senku will provide a single, independently versioned decision engine without making either application dependent on the other's internal implementation. It is **not** a coding agent, a job scheduler, an autonomous approval system, or a replacement for either application's deterministic controls.

### Design principles

1. **Decisions are advisory.** Senku returns structured assessments; callers decide what, if anything, they are authorised to do.
2. **Deterministic policy stays local.** Repository allowlists, secret scanning, validation commands, retry ceilings, publication gates, and run-state transitions remain with Kaseki or Soyuz.
3. **Prefer purpose-built contracts.** Named, versioned decision profiles provide stable schemas and calibrated behaviour.
4. **Retain a narrow escape hatch.** Trusted internal callers may submit bounded dynamic questions through a generic decision endpoint when a fixed profile cannot express the task.
5. **Minimise data exposure.** Callers create bounded, locally redacted evidence projections. Untrusted source text is data, not instructions.
6. **Keep operating costs small and visible.** Enforce per-client permissions, request and evidence bounds, provider-attempt budgets, and configurable inference quotas.
7. **Use native interfaces.** REST is the invocation mechanism; UTCP describes how clients discover and call those endpoints. No MCP server is planned in Senku.
8. **Make behaviour reproducible.** Version profiles, validate typed outputs, identify actual model versions where possible, and test against replayable fixtures.

## Architecture

```mermaid
flowchart TB
    Clients["Users and AI clients"] --> Soyuz["Soyuz control plane"]
    Soyuz --> Queue["Cloudflare Queue"]
    Queue --> Kaseki["Kaseki-Agent on Docker hosts"]

    Kaseki -->|"Authenticated HTTPS / REST"| Senku["Senku — Cloudflare Worker"]
    Soyuz -->|"Cloudflare Service Binding"| Senku
    Senku -->|"Decisions API"| OpenRouter["OpenRouter / JEV"]

    Soyuz -.->|"UTCP manual for Soyuz's native REST API"| Clients
    Senku -.->|"UTCP manual for approved decision tools"| Clients
```

**Responsibility boundaries**

| Component | Owns |
| --- | --- |
| **Kaseki-Agent** | Coding workflows, evidence collection, Pi execution, deterministic admission/safety policy, validation, retries, and publishing |
| **Soyuz** | Authenticated control-plane operations, canonical run state, queues, dashboard, run-data projections, and user-facing access |
| **Senku** | JEV connectivity, decision-profile registry, request/answer validation, bounded inference, provider metadata, and decision telemetry |
| **OpenRouter / JEV** | Typed model inference; Senku does not train or host its own JEV model |

Soyuz is intended to call Senku through a **Cloudflare Service Binding**. Kaseki, running outside Cloudflare on Docker hosts, will call Senku using authenticated HTTPS. The same Senku application logic serves both paths.

## Proposed API

All paths below are **planned**. Examples use the intended deployment hostname, which is not yet live.

### Profile-based decision endpoints

The preferred interface is a registry of explicit, versioned decision profiles:

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/v1/profiles/{profileId}/evaluate` | Evaluate evidence against a registered decision profile |
| `GET` | `/v1/profiles` | Discover permitted profiles and basic metadata |
| `GET` | `/v1/profiles/{profileId}` | Read a profile's published input/output contract |
| `POST` | `/v1/decisions` | Evaluate bounded dynamic questions; restricted to specifically authorised machine clients |
| `GET` | `/openapi.json` | OpenAPI document for supported HTTP operations |
| `GET` | `/utcp` | UTCP discovery manual for approved tool endpoints |
| `GET` | `/healthz` | Liveness without calling OpenRouter |
| `GET` | `/readyz` | Sanitised configuration readiness without a billable model call |

**Proposed initial profiles**

| Profile ID | Primary consumer | Intended output |
| --- | --- | --- |
| `task_admission_v1` | Kaseki | Task risk and routing classifications |
| `goal_check_v1` | Kaseki | Criterion satisfaction probabilities |
| `run_evaluation_v1` | Kaseki | Typed run-quality and completion assessments |
| `validation_recovery_v1` | Kaseki | Failure-cause classification and advisory recovery suggestion |
| `context_routing_v1` | Kaseki | Preserve / condense / discard recommendation |
| `phase_transfer_v1` | Kaseki | Relevance of bounded scouting facts |
| `run_operations_triage_v1` | Soyuz | Operational follow-up, likely area, and urgency |
| `kaseki_output_review_v1` | Soyuz | Compatibility with existing recorded-summary review |
| `kaseki_output_review_v2` | Soyuz | Recorded-outcome and summary consistency review |

The three Soyuz profile IDs are deliberately preserved from its existing implementation. A profile ID represents a stable decision contract; changing its meaning or breaking its response shape requires a new profile version.

Some Kaseki questions are generated dynamically from a run's goal contract. The initial migration may retain those questions on the **trusted** generic endpoint until a profile-based dynamic-criteria contract is fully specified and tested.

### Example: a profile evaluation

```http
POST /v1/profiles/validation_recovery_v1/evaluate
Authorization: Bearer YOUR_SENKU_CLIENT_TOKEN
Content-Type: application/json
```

```json
{
  "schemaVersion": "1",
  "runId": "kaseki-123",
  "state": {
    "command": "npm test",
    "exitCode": 1,
    "failureSummary": "Temporary network timeout"
  }
}
```

Illustrative proposed response:

```json
{
  "schemaVersion": "1",
  "requestId": "dec-123",
  "profileId": "validation_recovery_v1",
  "status": "completed",
  "provider": "jev",
  "model": "~typesafe/jev-latest",
  "answers": {
    "failure_cause": {
      "type": "choice",
      "choice": "timeout_or_flaky",
      "probabilities": {
        "timeout_or_flaky": 0.94,
        "code_defect": 0.04,
        "unknown": 0.02
      },
      "confidence": 0.94
    }
  },
  "usage": {
    "input_tokens": 420
  },
  "durationMs": 820,
  "attemptCount": 1
}
```

The specific answer names, probabilities, token counts, and timings above are examples, **not** live responses or a final profile schema. Senku does not execute the suggested action. Kaseki must apply its own command allowlists, confidence policy, retry limits, and validation gates.

### Generic decisions for trusted clients

`POST /v1/decisions` will accept a bounded `state` and a typed `questions` map using the established JEV concepts:

- `noul` — a binary/probabilistic assessment.
- `choice` — selection from a fixed set of labelled outcomes with a probability distribution.
- `score` — an ordinal score with a defined scale.

This endpoint is for explicitly authorised, trusted workloads, **not** an open-ended public classifier. Caller-controlled instructions must never be allowed to bypass resource limits, privacy controls, or Kaseki/Soyuz policy. The request and response envelopes will retain sufficient metadata for backward-compatible adapters to the existing Kaseki `DecisionService` and Soyuz JEV clients.

### Errors and compatibility

The v1 API will return consistent machine-readable failures, for example:

```json
{
  "error": {
    "code": "PROVIDER_UNAVAILABLE",
    "message": "The decision provider is unavailable.",
    "retryable": true,
    "requestId": "dec-123"
  }
}
```

Planned categories include validation failures, unauthorised callers, forbidden profiles, payload-limit violations, provider timeouts, malformed model responses, and quota exhaustion. A provider failure is **not** an affirmative classification.

All requests and results will use explicitly versioned contracts. The service will reject unknown profiles and unsupported major schema versions rather than silently reinterpret them.

## UTCP: discover the API, do not duplicate it

[Universal Tool Calling Protocol (UTCP)](https://github.com/universal-tool-calling-protocol/utcp-specification) is a discovery-and-invocation standard. Senku will publish a manual at `GET /utcp` describing approved tools, JSON schemas, authentication requirements, and the existing REST endpoints that execute them.

A UTCP client discovers a tool and then calls its native HTTP endpoint directly. **`/utcp` is not a second inference endpoint**, and Senku does not need a separate UTCP execution server.

Planned tool examples include:

| UTCP tool | Native endpoint |
| --- | --- |
| `assess_validation_failure` | `POST /v1/profiles/validation_recovery_v1/evaluate` |
| `evaluate_goal_criteria` | `POST /v1/profiles/goal_check_v1/evaluate` |
| `assess_run_quality` | `POST /v1/profiles/run_evaluation_v1/evaluate` |
| `triage_run_evidence` | `POST /v1/profiles/run_operations_triage_v1/evaluate` |

**Discovery does not grant permission.** The UTCP manual must not contain secrets, and all execution endpoints enforce authorisation independently. Internal-only profiles need not be included in a public manual; a separately authenticated catalogue may be provided if needed.

Generate both `/openapi.json` and the UTCP manual from the same versioned TypeScript source-of-truth where practical. Validate the emitted manual with a conformant UTCP client against the supported specification version.

## Integrating Kaseki-Agent

Kaseki already has a provider-neutral `DecisionService` abstraction. The intended migration is to add a remote Senku adapter behind that interface without changing higher-level execution policy.

Kaseki continues to prepare and redact bounded evidence locally. Senku returns classifications. Kaseki remains solely responsible for deciding whether to admit a task, retry a command, discard context, publish a change, or stop a run.

The migration must preserve existing **stage-specific** failure behaviour. In particular, a Senku outage must never disable deterministic security, validation, or publishing gates. For context routing, uncertain or unavailable classifications must not cause protected evidence to be dropped.

## Integrating Soyuz

Soyuz already offers an authenticated dashboard, canonical D1 run records, and JEV advisory analysis. The intended migration replaces Soyuz's direct OpenRouter decision client with a Senku client using a Cloudflare Service Binding, while Soyuz continues to:

- Authorise dashboard users with its existing identity and scope checks.
- Read canonical run records and prepare approved, bounded evidence projections.
- Preserve its current `POST /dashboard/api/analysis/decisions` contract during migration.
- Retain user feedback and run-analysis presentation locally.
- Decide which profiles a user or tool may invoke, without exposing arbitrary model questions.

### Soyuz's planned MCP → UTCP transition

**Soyuz is separately planned to remove its MCP server and publish a UTCP tool manual instead.** Its existing native REST control-plane endpoints remain the underlying operations for run creation, listing, inspection, events, and cancellation.

Soyuz's UTCP manual should describe **Soyuz-owned** tools and call Soyuz's existing REST API directly. Where useful, Soyuz may expose a narrowly scoped `assess_run` operation that reads an authorised run and invokes Senku behind the scenes. That avoids giving an external agent unrestricted access to raw JEV question definitions or private run evidence.

Senku's `/utcp` manual, by contrast, describes approved **decision-service** capabilities. The two manuals have distinct ownership and need not duplicate one another.

Neither the Soyuz MCP removal nor its UTCP replacement is implemented by Senku; those are coordinated changes in [CyanAutomation/soyuz](https://github.com/CyanAutomation/soyuz).

## Security and data handling

Senku handles potentially sensitive task text, validation output, and repository evidence. Its threat model must treat *all caller-supplied content as untrusted data*, including content originating from an authenticated client.

The initial design requires:

- **Separate client identities:** distinct credentials and least-privilege profile allowances for Kaseki and Soyuz. A Service Binding is a private transport path, not a substitute for an explicit authorisation policy.
- **Credential isolation:** the OpenRouter API key is stored only as a Senku Worker secret; it is never returned to callers or placed in UTCP metadata.
- **Local evidence minimisation:** callers redact and bound data before transmission; Senku validates and enforces its own hard limits. Redaction is not a complete secret scanner.
- **Provider containment:** fixed provider destinations, allowed models, bounded timeouts and attempts, no arbitrary URL forwarding or caller-selected upstream credentials.
- **Safe logging:** no raw task prompts, repository source, diffs, credential values, request bodies, or model answers in routine logs.
- **Advisory output:** typed answers do not themselves authorise side effects or bypass local deterministic controls.
- **Abuse and cost controls:** per-client quotas, profile permissions, maximum request/question sizes, bounded inference and explicit handling of retry amplification.
- **Strict response validation:** check expected answer keys, types, choice labels, probability ranges and score scales before returning a result.

An unrestricted generic classifier is particularly sensitive. It must remain protected even if a publicly accessible UTCP discovery document exists.

## Cloudflare Free-plan design

Senku targets a small, stateless Cloudflare Worker deployable within the applicable [Workers Free limits](https://developers.cloudflare.com/workers/platform/limits/).

The Worker should do little more than authenticate, validate a bounded JSON request, select a profile, make one external Decisions API call, validate its response, and return typed JSON. Waiting for the provider's network response is not CPU execution time, but local parsing and validation **do** consume CPU time.

Implementation choices:

- Native TypeScript and Web APIs; avoid unnecessary framework and dependency overhead.
- No D1, KV, Queue, Durable Object, or persistent storage required for the initial service.
- Bounded payloads and streamed/size-limited provider responses.
- Default to a single provider attempt; any retries must be deliberate, bounded, and observable.
- Request, provider, and token-usage counters without persisting sensitive evidence.
- Measure CPU time and Free-tier compatibility against representative Kaseki and Soyuz inputs before production migration.

The Free-plan allowance is shared with other applicable Workers on the account. **Free hosting is a design target, not a guarantee**; limits and prices can change. OpenRouter inference is independently billable, so budgets and usage reporting are required even when Cloudflare hosting costs remain zero.

## Development approach

The project will use native TypeScript throughout. A prospective layout is:

```text
src/
  index.ts                  # Cloudflare Worker entry point
  api/                      # HTTP routes and error envelopes
  auth/                     # Caller identity and profile permissions
  contracts/                # Shared typed request and result schemas
  decisions/                # Common decision engine
  profiles/                 # Named/versioned question definitions
  providers/openrouter/     # JEV Decisions API adapter
  utcp/                     # Discovery manual generation
  observability/            # Safe usage and execution metrics
test/                       # Unit, contract, fixture, and Worker tests
wrangler.jsonc              # Worker deployment configuration
```

This tree is **proposed**, not present yet. Build and deployment commands will be documented after the scaffold is implemented.

### Testing requirements

Before consumer migration, provide:

1. Unit tests for typed questions and answers, profile dispatch, permissions, and errors.
2. Mocked provider tests for timeout, malformed responses, oversized payloads, and unavailable credentials.
3. Worker-runtime tests for the intended Free-plan CPU budget.
4. Golden fixtures captured from sanitised Kaseki and Soyuz decision scenarios.
5. Contract tests confirming compatibility with Kaseki's `DecisionService` and Soyuz's existing advisory result shapes.
6. UTCP-manual validation and tests verifying that tools call the correct native REST paths.
7. Tests ensuring model output never authorises a deterministic execution action.

## Roadmap

- [ ] **Phase 1 — Foundation:** Worker scaffold, typed contracts, OpenRouter adapter, authentication, bounded requests, safe errors, and tests.
- [ ] **Phase 2 — Profiles:** Versioned profile registry, Kaseki and Soyuz baseline profiles, OpenAPI generation, usage instrumentation, and reference fixtures.
- [ ] **Phase 3 — Soyuz integration:** Service Binding, compatible dashboard decision adapter, preserved profile semantics, and removal of duplicated provider code.
- [ ] **Phase 4 — Kaseki integration:** Remote `DecisionService` adapter, staged migration, regression/evaluation comparisons, and documented local failure policies.
- [ ] **Phase 5 — UTCP:** Publish a validated Senku manual; coordinate Soyuz's separate migration from MCP to UTCP.
- [ ] **Phase 6 — Calibration:** Replayable evaluation datasets, model/version comparisons, outcome feedback, and evidence-based threshold improvements.

No roadmap checkbox implies an implementation exists until the corresponding code, tests, and documentation land.

## Related projects and references

- [Kaseki-Agent](https://github.com/CyanAutomation/kaseki-agent) — disposable Docker coding-agent execution harness
- [Soyuz](https://github.com/CyanAutomation/soyuz) — Cloudflare control plane for Kaseki
- [UTCP specification](https://github.com/universal-tool-calling-protocol/utcp-specification) — tool discovery and direct invocation
- [Cloudflare Workers documentation](https://developers.cloudflare.com/workers/) — execution runtime and deployment
- [OpenRouter](https://openrouter.ai/) — initial decision-model provider

## License

[MIT](LICENSE) © 2026 CyanAutomation.
