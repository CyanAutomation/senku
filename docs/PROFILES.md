# Decision profile contracts

The profile engine exposes five server-owned, versioned contracts through `POST /v1/profiles/{profileId}/evaluate`. Callers send evidence inside `{ "schemaVersion": "1", "input": ... }`; Senku constructs the JEV questions and keeps provider calls, validation, and permissions centralized. `GET /v1/profiles` discovers only permitted profiles. `GET /v1/profiles/{profileId}` returns the permitted profile's machine-readable input/output schemas and limits. The authenticated `/openapi.json` document uses the same schemas.

No profile accepts caller-supplied questions, criteria, provider URLs, or model names. No profile result authorises a task, retry, code change, publication, queue transition, or other side effect. Kaseki and Soyuz continue to enforce their own deterministic policies.

## Profiles and limits

| Profile ID | Owner | Evidence | Projected evidence limit | Questions |
| --- | --- | --- | ---: | ---: |
| `run_operations_triage_v1` | Soyuz | Run status, stage, operational health, failure class, lifecycle timestamps | 12 KiB | 3 |
| `kaseki_output_review_v1` | Soyuz | Canonical run status, failure class, exit code, changed-file count, summary up to 2,000 characters | 8 KiB | 3 |
| `kaseki_output_review_v2` | Soyuz | Same bounded evidence as v1 plus recorded-outcome scoring | 8 KiB | 4 |
| `task_admission_v1` | Kaseki | Repository URL/ref, task prompt, validation commands, allowlist, task/publish modes, stage settings | 32 KiB | 6 |
| `validation_recovery_v1` | Kaseki | Command, exit code, and bounded validation output | 8 KiB | 2 |

The request body cap is 128 KiB. Per-profile projected-evidence caps are checked again after validation and redaction, before provider invocation.

## UTCP tool names

Authenticated `GET /utcp` publishes these profile tools using the central permission matrix. The `request` argument contains the same versioned REST envelope shown above; each tool sends that object directly to its existing evaluation route.

| UTCP tool | Profile ID | Identity |
| --- | --- | --- |
| `assess_task_admission` | `task_admission_v1` | Kaseki |
| `assess_validation_recovery` | `validation_recovery_v1` | Kaseki |
| `triage_run_evidence` | `run_operations_triage_v1` | Soyuz |
| `review_kaseki_output_v1` | `kaseki_output_review_v1` | Soyuz |
| `review_kaseki_output_v2` | `kaseki_output_review_v2` | Soyuz |

The published manual is discovery metadata. It does not add an execution or inference route, and every result remains advisory. See [UTCP.md](UTCP.md) for client-side authentication and request mapping.

## Input summaries

The full machine-readable schema is returned under `inputSchema` from `GET /v1/profiles/{profileId}` and appears in the caller's `/openapi.json` document. All schemas reject undeclared object properties.

### `run_operations_triage_v1`

Requires one `run` object containing:

- `status`: `admitting`, `queued`, `claimed`, `running`, `cancel_requested`, `cancelled`, `completed`, `failed`, or `admission_failed`.
- `stage`: string up to 128 bytes or `null`.
- `operationalHealth`: `unknown`, `healthy`, or `suspect_stalled`.
- `failureClass`: string up to 128 bytes or `null`.
- `createdAt`: required timestamp; `queuedAt`, `startedAt`, `completedAt`, and `lastHeartbeatAt`: timestamps or `null`.

It returns `needs_followup` (NouL), `likely_area` (`execution`, `control_plane`, or `unknown`), and `severity` (0–2: Routine, Needs review, Urgent).

### `kaseki_output_review_v1` and `kaseki_output_review_v2`

Require `canonicalRun` with status, nullable failure class, nullable integer exit code, and nullable changed-file count, plus a required `summary` string or `null`. The summary is capped at 2,000 characters and 8,000 UTF-8 bytes. Changed-file count is bounded to 0–1,000,000.

Kaseki's scheduler uses `-1` when a process exit code is unavailable, and uses normal OS/signal-derived values such as `143` on termination. Soyuz's stored run row preserves the integer; its failed/cancelled callback schemas also accept integer exit codes. The bounded compatibility policy is therefore `-1..255`: it preserves the observed unknown sentinel, ordinary process codes, and common signal-derived statuses while rejecting other negatives and implausibly large values. Completed Soyuz callbacks still require zero.

V1 returns `summary_specificity`, `outcome_alignment`, and `evidence_strength`. V2 adds `recorded_outcome`. These IDs preserve the existing answer meanings and scales; V2 does not silently replace V1.

### `task_admission_v1`

Requires an HTTP or HTTPS `repoUrl` without URL credentials, query, or fragment. Optional fields are `ref`, `taskPrompt`, `validationCommands`, `changedFilesAllowlist`, `taskMode` (`patch` or `inspect`), `publishMode` (`auto`, `none`, `branch`, or `pr`), `startupCheck`, `scouting`, and `goalSetting`.

String, list, and nested-setting limits are encoded in the published schema and enforced by the runtime validator. The profile returns the existing credential, permission, security-boundary, risk, task-type, and validation-focus answer IDs. Kaseki retains its deterministic admission policy.

### `validation_recovery_v1`

Requires `command` (up to 1,000 bytes), integer `exitCode` in 0–255, and `output` (up to 6,000 UTF-8 bytes). The provider projection redacts the full bounded output first, then retains at most the final 5,000 UTF-16 code units. It fits the redacted projection to the 8 KiB serialized evidence limit and rechecks that limit before making a provider request. This prevents truncation from removing a credential's identifying prefix and leaving its suffix.

The profile answers `validation_failure_cause` and `validation_recovery_action`. A retry suggestion remains advisory; Kaseki's local retry policy remains authoritative.

Redaction follows Kaseki's `redactJevEvidence()` patterns for private keys, bearer credentials, AWS access key IDs, JWT-shaped tokens, URL passwords, common provider/GitHub/chat tokens, and password/token assignments. Key names matching secret patterns are replaced recursively. These deterministic patterns are not a complete credential detector; callers must continue minimising evidence before sending it.

## Output and confidence

Every successful profile response has the same top-level fields: `schemaVersion`, `requestId`, `status`, `profileId`, `profileVersion`, `provider`, `model`, `answers`, `result`, optional `usage`, `durationMs`, and `attemptCount`. `result` is the profile's canonical answer map and duplicates `answers` for compatibility. Resolved model is the provider-returned model ID, not the configured alias.

Canonical NouL answers include `noul`, deterministic `true`/`false` probabilities, and `confidence: null`. Choice and score answers carry exact probability maps, validated labels/scales, and numeric or nullable confidence. The public JSON Schemas preserve `null` rather than manufacturing a value.

Kaseki's current local decision helper and consumer types expect numeric confidence for some answers. Any future adapter must map `null` to unavailable/zero confidence for confidence gates (or otherwise conservatively block confidence-dependent behavior), and must not replace null with a high estimate. This compatibility handling belongs in the consumer adapter; Senku's canonical contract remains nullable.

Optional provider usage includes only values OpenRouter supplies. Senku does not estimate usage or cost. Profile errors return the shared safe error envelope; no successful assessment is returned for invalid provider output.

## Ownership and versioning

The sole permission declaration is `src/auth/permissions.ts`. The registry derives public allowed-client metadata and profile ownership from that policy. Tests check that each registered profile's ID, owner, and permissions agree.

The profile's `inputSchema` is a JSON Schema definition used by runtime validation and exposed through discovery. The handwritten domain validator remains responsible for semantic checks such as URL credential rejection and parsed timestamps. Runtime-schema parity tests exercise each profile and bounded edge cases. Output schemas are derived from the server-owned question map, so answer IDs, labels, scales, and nullable confidence remain connected to the inference contract.

Changing required input, question meaning, answer IDs, labels, score scale, or result shape requires a new versioned profile ID. Compatible implementation corrections may retain the version when the public contract is unchanged; document the reason in `docs/PHASE-2B-DECISIONS.md`.

## Generic endpoint and deferred work

`POST /v1/decisions` remains a separate Kaseki-only bounded interface for trusted dynamic questions. Soyuz profile access does not grant generic access, and this endpoint is not exposed as a UTCP tool. Senku UTCP describes decision evaluations; future Soyuz UTCP belongs in the Soyuz repository and will describe run-management operations. MCP, Service Binding setup, consumer adapters, storage/history, retries, fallback models, and dashboard changes remain deferred.
