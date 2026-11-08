# Internal decision profiles

## Status and purpose

Phase 2A adds a typed, versioned profile engine that runs inside Senku. It does not add profile-specific HTTP routes or a public profile catalogue. The only implemented decision endpoint remains `POST /v1/decisions`.

A profile is a server-owned decision contract. It fixes an identifier and version, owning client, validated input projection, JEV question map, answer validation, and stricter evidence limit. Callers provide evidence only; they cannot supply or replace questions, criteria, model, or provider destination.

The internal engine checks profile permission, validates and projects the evidence, checks the standard request limits, calls the shared OpenRouter adapter once, validates the profile answer map, and returns typed answers with operational metadata. It does not write decision history or log the evidence.

## Registered profiles

| Profile ID | Version | Owner | Evidence and purpose |
| --- | ---: | --- | --- |
| `run_operations_triage_v1` | 1 | Soyuz | Run status, stage, operational health, failure class, and lifecycle timestamps. Returns follow-up probability, likely area, and urgency score. |
| `kaseki_output_review_v1` | 1 | Soyuz | Canonical run status, failure class, exit code, changed-file count, and a summary of at most 2,000 characters. Returns specificity, status alignment, and evidence strength. |
| `kaseki_output_review_v2` | 2 | Soyuz | The same bounded projection as v1, with the additional recorded-outcome score. It does not replace v1 automatically. |
| `task_admission_v1` | 1 | Kaseki | Bounded Kaseki task request fields. Returns credential, permission, security-boundary, risk, task-type, and validation-focus classifications for advisory use. |
| `validation_recovery_v1` | 1 | Kaseki | A command, exit code, and bounded validation output. Returns failure-cause and recommended-action classifications only. |

The Soyuz question names, answer keys, choice labels, score scales, and recorded-summary projection match its current `src/jev/profiles.ts` and `src/jev/analysis.ts`. Soyuz remains responsible for authorising dashboard access and reading the run record before constructing the evidence projection. Senku receives no run UUID and performs no D1 lookup.

The Kaseki answer keys and criteria match its current `buildTaskAdmissionRequest()` and `buildValidationRecoveryQuestions()` builders. Kaseki retains deterministic credential screening, admission, command allowlists, retry ceilings, and execution policy. The profiles do not admit or reject tasks, run commands, retry validations, edit files, or authorise publication.

## Input and output contracts

Each profile rejects unexpected top-level fields and validates its required fields, enums, types, numeric ranges, string sizes, nested settings, and aggregate evidence size. The task-admission input uses Kaseki's current task-mode values (`patch`, `inspect`) and publish-mode values (`auto`, `none`, `branch`, `pr`). Common credential patterns are redacted before Kaseki state is sent upstream; Kaseki's own deterministic screening remains authoritative.

Profile evidence limits are stricter than the generic 128 KiB request limit:

| Profile | Maximum projected evidence |
| --- | ---: |
| `run_operations_triage_v1` | 12 KiB |
| `kaseki_output_review_v1` | 8 KiB |
| `kaseki_output_review_v2` | 8 KiB |
| `task_admission_v1` | 32 KiB |
| `validation_recovery_v1` | 8 KiB |

The shared provider validates exact answer keys and types, probability maps, confidence values, choice labels, score ranges, and score legends. Profile validation repeats the profile-specific key, type, choice-label, and score-range checks. The typed result keeps the canonical JEV answers, including probability distributions, confidence, and legends. Missing or explicitly null choice/score confidence is returned as `null`; NouL probabilities are normalised deterministically.

Results carry the resolved provider model and safe operational metadata: profile ID/version, client identity, question count, evidence size, provider duration, one attempt, and usage/cost fields when supplied. They do not contain annotation bodies or raw input evidence.

## Ownership and permissions

The central policy in `src/auth/permissions.ts` currently allows:

- `kaseki` to use the generic decision endpoint, `task_admission_v1`, and `validation_recovery_v1`.
- `soyuz` to use the three Soyuz-owned profiles, once an authenticated Soyuz identity is supplied by a future adapter.
- Unauthenticated callers to use neither.

The HTTP Worker currently authenticates only Kaseki. The internal engine requires an explicit client identity and checks the profile policy before input validation or provider invocation. A future Cloudflare Service Binding will still need an explicit identity-to-profile permission check.

## Versioning and adding profiles

Profile IDs are stable and include their contract version. A behavior change that changes required input, question meaning, answer keys, choice labels, score scale, or result shape requires a new ID such as `some_decision_v2`. A compatible implementation correction may retain the same public profile version when it does not change the contract; record the reason in the decision notes.

To add a profile:

1. Derive its question map and evidence needs from an implemented consumer builder.
2. Define a typed input and strict, bounded validator.
3. Build the evidence projection from validated input and keep questions server-owned.
4. Add a profile-specific output validator that preserves canonical answers.
5. Add the ID and explicit client permission to the in-code registry and central policy.
6. Add contract, permission, invalid-input, invalid-output, and mocked-provider tests.
7. Document its owner, limits, deterministic boundaries, and version semantics.

There is no dynamic module loading, database-backed discovery, caller-supplied question definition, batching, fallback model, or per-profile provider transport.

## Relationship to generic decisions and Phase 2B

The generic endpoint remains available to the authenticated Kaseki client for bounded decisions that do not have an approved fixed profile. It accepts a caller-supplied question map, so it remains an internal trusted interface. It shares the same provider adapter and answer validation as profiles.

Phase 2B may add `POST /v1/profiles/{profileId}/evaluate`, authenticated profile discovery, OpenAPI, and a UTCP manual. Those adapters must preserve the registry's client permissions and strict profile input validators. Goal Check, Run Evaluation, context routing, and phase transfer need separate contract work before registration.
