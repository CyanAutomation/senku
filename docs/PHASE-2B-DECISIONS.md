# Phase 2B implementation decisions

## Scope

Phase 2B exposes the five Phase 2A profiles through authenticated REST, adds independent Kaseki and Soyuz machine identities, publishes permission-filtered profile discovery and OpenAPI 3.1, hardens validation-recovery redaction, and documents consumer compatibility findings. It preserves `POST /v1/decisions`, `/healthz`, and `/readyz`.

No Kaseki-Agent or Soyuz source is changed. No UTCP/MCP route, Service Binding, consumer migration, persistence, provider retry, model fallback, UI, or production deployment is implemented.

## Authentication boundary

- `SENKU_KASEKI_API_TOKEN` and `SENKU_SOYUZ_API_TOKEN` must both be present, satisfy the existing 32–1,024 printable-ASCII policy, and be different. Missing, malformed, or duplicate configuration makes authentication fail closed and `/readyz` false.
- Each token maps to exactly one identity. The generic decisions endpoint remains Kaseki-only. Profile evaluation, discovery, and OpenAPI use the same `src/auth/permissions.ts` policy.
- `WorkerDependencies.resolveIdentity` is a trusted internal injection point for a future server-derived identity. The current implementation uses bearer authentication. It does not read identity from JSON, query parameters, or an untrusted identity header; a future Service Binding must still call the central profile permission check.
- Authenticated responses are `no-store`. CORS remains disabled.

## Profile HTTP and error behavior

The Worker is a thin route adapter around the Phase 2A registry and engine. Evaluation uses `{ "schemaVersion": "1", "input": ... }`, checks authentication and profile permission before reading the body, validates the exact profile input, and returns one stable response envelope with `profileId`, `profileVersion`, `answers`, `result`, optional usage, resolved model, duration, and `attemptCount: 1`. `result` remains identical to the canonical answer map for compatibility.

Internal errors map to the shared safe error envelope: unknown routes 404; unknown or unauthorized profile IDs 403; invalid input/version 400; oversized request/evidence 413; invalid provider/profile output 502; provider timeout 504; missing configuration 503; malformed server-owned profile construction or other unexpected failures 500. Profile authorization runs before registry lookup so callers receive the same response for unknown and inaccessible IDs. Provider retryable classifications are retained, and failed-request logs record whether the single provider attempt began. Error bodies and routine logs contain no evidence, prompts, answer payloads, upstream bodies, credentials, or stack traces. Invalid and forbidden requests do not call the provider.

Discovery hides profiles the identity cannot invoke. An individually requested unknown or forbidden profile ID returns the same 403 response without disclosing its ID or contract. `/openapi.json` is generated per authenticated identity and advertises only routes/contracts available to that identity. The Soyuz document does not advertise Kaseki's generic endpoint.

## Contract and OpenAPI source of truth

- Each profile owns its input JSON Schema next to its runtime validator. The runtime schema checker applies object shape, field, enum, array, string, byte, numeric, and version constraints before the profile-specific semantic validator runs.
- Runtime validators continue to enforce semantic rules such as safe repository URL composition and parseable timestamps. Tests compare representative valid/invalid inputs against both schema and validator.
- Profile output schemas are derived from server-owned question definitions, including exact answer IDs, labels, score ranges, and nullable confidence.
- Shared OpenAPI components cover generic questions/answers, usage, errors, authentication, health/readiness, and all implemented routes. Reference, route, permission, and schema parity tests guard the generated document.
- Registry allowed-client metadata is derived from `PROFILE_CLIENT_PERMISSIONS`; profiles no longer maintain a second allowed-client list. Profile ownership is also computed from the central policy.

## Validation-recovery redaction and limits

Kaseki's `redactJevEvidence()` was inspected. Senku now applies the same practical patterns to the full validated command and output before truncating: private-key blocks, authorization/bearer strings, AWS access-key IDs, JWT-shaped strings, URL passwords, common OpenAI/GitHub/chat tokens, password/token assignments, and sensitive key names. This is deterministic pattern redaction and cannot guarantee detection of every credential.

The profile validates output to 6,000 UTF-8 bytes, redacts it, retains at most the last 5,000 UTF-16 code units without splitting a surrogate pair, then shrinks the retained tail as needed to keep the serialized projection within 8 KiB. The profile engine rechecks the final evidence and full provider request limits before inference.

## Soyuz exit-code compatibility

The current Kaseki scheduler stores `code ?? -1` when process exit status is unavailable, and maps cancellation to `143`. Soyuz's failed and cancelled callback schemas accept integer exit codes; its stored `exit_code` field is `number | null`. Its completed callback contract requires zero. Senku's Soyuz output-review schemas therefore accept `-1..255`, preserving the observed unknown sentinel and ordinary/signal-derived process values while rejecting other negative and large values. This policy does not rewrite stored run meaning.

## Nullable confidence compatibility

Senku's provider adapter emits null when JEV has no separate confidence, including all NouL answers and absent choice/score confidence. The OpenAPI and profile output schemas state this accurately. Kaseki's local numeric confidence consumers cannot directly represent null. A future Kaseki adapter must treat null as unavailable/zero confidence for confidence gates (or otherwise conservatively prevent confidence-dependent action); it must never substitute an optimistic value. Senku's canonical contract is not weakened to fit the narrower consumer type.

## Cloudflare Free and provider spending

Senku remains native TypeScript and Web APIs, stateless, without runtime framework dependencies, and configured for one provider subrequest and a 10 ms CPU budget. The fixed endpoint and `~typesafe/jev-latest` alias remain the only provider/model selection. There is no retry or fallback. Routine tests use mocked responses; the live smoke test remains opt-in. The repository owner has a dedicated Senku OpenRouter key; operators should set a provider-side spending limit, but this implementation has not verified one.

The performance smoke test runs all five authenticated profile routes through the local Worker with mocked JEV responses. It records request bytes, evidence bytes, question count, one attempt per request, provider-call count, and local wall time. The Wrangler dry-run build reports bundle output size. These results measure a local workload, not Cloudflare production billed CPU.

### Local performance results

Results below are from `npm run perf:smoke` and Wrangler's `npm run build` dry run for this branch. Times are local full HTTP wall time with a mocked provider, averaged over three requests per profile. They are validation artifacts, not production CPU measurements.

| Profile | Request bytes | Projected evidence bytes | Questions | Average local wall time | Provider attempts/request |
| --- | ---: | ---: | ---: | ---: | ---: |
| `run_operations_triage_v1` | 582 | 594 | 3 | 2.00 ms | 1 |
| `kaseki_output_review_v1` | 2,266 | 2,412 | 3 | 4.33 ms | 1 |
| `kaseki_output_review_v2` | 2,267 | 2,413 | 4 | 1.67 ms | 1 |
| `task_admission_v1` | 32,144 | 32,114 | 6 | 4.67 ms | 1 |
| `validation_recovery_v1` | 6,077 | 5,056 | 2 | 2.00 ms | 1 |

The maximum generic request smoke case used the full 131,072-byte request allowance and averaged 2.67 ms locally. Wrangler reported a 99.70 KiB upload bundle (20.86 KiB gzip). All provider responses were mocked; the live provider smoke test was not run.

## Deferred work and known limits

- The planned `senku.scheimann.workers.dev` hostname is not assumed to exist and was not contacted or deployed.
- Soyuz's future Service Binding must supply a trusted identity context; no header-based identity shortcut is allowed.
- Consumers still need their own adapters and conservative failure behavior.
- Redaction covers known patterns but is not a complete secret scanner. Callers should continue to minimise and sanitize evidence locally.
- A local workerd elapsed-time smoke test cannot establish Cloudflare CPU use or provider cost limits.
- UTCP discovery, MCP, storage/history, automatic retries, dashboard integration, and production deployment are for later phases.
