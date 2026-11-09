# Phase 2A implementation decisions

## Architecture

Phase 2A retains the Phase 1 HTTP surface and adds an internal TypeScript profile engine. Each profile supplies a stable ID, explicit version, owner, allowed client identities, strict input validator, server-owned questions, bounded evidence projection, and profile-specific answer validator. A deterministic in-code registry rejects duplicates and unknown IDs.

Generic decisions and profile evaluations use the same OpenRouter adapter. There is no profile-specific HTTP client, public profile route, dynamic registry, persistent storage, history, batching, retry, or fallback model. The profile registry is initialized once from five static definitions.

The engine returns the canonical typed answers as its profile result so probability distributions and confidence are retained. It also returns safe operational metadata for future adapters and usage analysis without recording evidence or answers in routine logs.

## Consumer compatibility findings

Soyuz's current profile source contains exactly three profiles:

- `run_operations_triage_v1`: `needs_followup`, `likely_area`, `severity`; choice labels `execution`, `control_plane`, `unknown`; score scale `Routine`, `Needs review`, `Urgent`. Its input uses the run status, stage, health, failure class, and lifecycle timestamps projected by Soyuz.
- `kaseki_output_review_v1`: `summary_specificity`, `outcome_alignment`, `evidence_strength`; labels `consistent`, `unclear`, `inconsistent`; the two existing three-level score scales.
- `kaseki_output_review_v2`: those four existing answer fields plus `recorded_outcome`, with its three-level recorded-outcome scale.

Output-review profiles accept only canonical run fields and a summary up to 2,000 characters. The summary is untrusted data and does not establish code correctness. Senku does not receive repository code, prompts, URLs, artifacts, logs, or dashboard data for those profiles. Soyuz remains responsible for user authorisation, reading D1, and creating the approved projection.

Kaseki's current task-admission builder defines `contains_credentials`, `changes_permissions`, `crosses_security_boundary`, `risk_level`, `task_type`, and `validation_focus`; its criteria and labels are retained. The task-admission profile returns advisory answers only. Kaseki's local credential screening and admission policy remain authoritative.

Kaseki's validation-recovery builder defines `validation_failure_cause` and `validation_recovery_action`, retaining its seven cause labels and four action labels. The profile returns a recommendation only. Kaseki retains the exact-command allowlist, transient-failure check, confidence threshold, observe/auto mode, and retry ceiling.

Goal Check, Run Evaluation, context routing, and phase transfer were inspected and deferred. Dynamic criterion questions, protected-information handling, fail-open behavior, and relevance-scored transfer evidence require distinct contracts. They are not represented by placeholder profiles.

Neither Soyuz nor Kaseki-Agent was modified.

## Phase 1.1 hardening

### OpenRouter response compatibility

The Decisions API documents optional response `annotations` as an array of request-level source objects. Senku accepts only a bounded array of non-empty JSON objects (at most 32 objects and 16 KiB of annotation JSON), in addition to the existing 64 KiB whole-response limit. Malformed, deeply nested, high-node-count, or oversized annotations are rejected. Annotation bodies are discarded: they are not returned, logged, or persisted. The root response validator still rejects unknown fields and keeps strict answer validation.

Choice and score confidence now accept a finite 0–1 number, omission, or explicit `null`; omission and null normalise to `null`. Invalid types and values are rejected. Missing score legends are reconstructed only from the server-declared scale. NouL probabilities remain a deterministic complement normalisation.

Unexpected upstream failures, including stream-read errors, map to safe provider error codes. Upstream bodies, authentication details, and stack traces are not exposed.

### Machine authentication

The Kaseki machine token must contain 32–1,024 printable ASCII characters. Leading, trailing, or embedded whitespace is invalid; Senku does not trim the configured value. Token values are compared by SHA-256 digest using a fixed-length byte comparison. Missing or malformed configuration fails closed, and `/readyz` reports `not_ready`. The recommendation is to generate at least 256 bits of randomness with `openssl rand -base64 32`.

The OpenRouter API key remains a Worker secret and a local `.dev.vars` value. A key's existence does not mean it is installed in a local, CI, or deployed environment. Examples contain placeholders only.

### Fixed model and cost controls

Every generic and profile request uses the exact alias `~typesafe/jev-latest`. If `JEV_MODEL` is set, it must equal that exact value; caller input cannot select a model. OpenRouter's resolved model identifier is retained in successful responses, profile metadata, and safe logs. The alias is fixed, but its resolved model may change over time by design.

The provider makes one attempt, uses one fixed upstream URL, a bounded timeout, a 128 KiB request cap, a 64 KiB provider-response cap, and the existing 64-question maximum. Profiles use stricter evidence caps. No automatic retry or batch splitting is added. The Worker config allows one subrequest per invocation. Senku does not introduce a database or in-memory counter to simulate global spend control.

Aggregate inference spend depends on a provider-side cap on the dedicated Senku OpenRouter key. The repository documents how to set and verify that cap; it does not claim that one is configured.

## Authorisation

The central policy allows Kaseki to use generic decisions and its two owned profiles. Soyuz owns the three Soyuz profiles, but no Soyuz credential or Service Binding path is implemented. The internal engine requires an explicit client identity and performs permission checks before validating profile input or invoking the provider. Unauthenticated profile evaluation is denied. Generic HTTP authorization continues to use only the existing Kaseki identity.

## Cloudflare Workers Free

The Worker retains native Web APIs, no runtime framework, no persistent binding, and one external provider call. The current Cloudflare Workers documentation lists Free limits of 10 ms CPU per request, 128 MB memory, 50 subrequests per request, and 100,000 requests/day shared at account level. Senku's configuration sets a 10 ms CPU limit and one subrequest. Local performance output is wall-clock time and bundle size; it is not a measurement of production billed CPU.

## Verification and known limitations

Offline tests mock provider responses; CI and `npm test` never make a paid call. `npm run smoke:provider` is a separate manual opt-in using synthetic evidence and the shared provider adapter. It requires an operator-supplied `OPENROUTER_API_KEY` and was not run as part of this implementation.

The local provider-side spending limit was not verified. Production secrets, deployment, Soyuz identity, Service Binding, remote Kaseki client, public profile routes, OpenAPI, UTCP, and persistent usage reporting remain unimplemented. No production deployment occurred.

## Deferred Phase 2B work

Add authenticated profile REST evaluation and discovery routes, document each public profile contract, expose OpenAPI and UTCP from the same source of truth, and integrate the Soyuz Service Binding and Kaseki remote `DecisionService` behind explicit identities. Preserve all current deterministic safeguards and run consumer regression tests before migration.

## Source references checked on 2026-11-08

- [OpenRouter Decisions API reference](https://openrouter.ai/docs/api/api-reference/alphadecisions/submit-a-decisions-request)
- [OpenRouter API key spending limit](https://openrouter.ai/docs/api/api-reference/api-keys/create-keys)
- [OpenRouter current key usage and remaining limit](https://openrouter.ai/docs/api/api-reference/api-keys/get-current-key)
- [Cloudflare Workers platform limits](https://developers.cloudflare.com/workers/platform/limits/)
- Soyuz: `src/jev/profiles.ts`, `src/jev/profile-ids.ts`, `src/jev/analysis.ts`
- Kaseki-Agent: `src/task-admission.ts`, `src/validation-recovery.ts`, `src/jev-workflow-helpers.ts`
