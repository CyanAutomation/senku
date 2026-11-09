# REST API contract

Senku exposes a versioned REST API. All JSON responses use `Cache-Control: no-store`. The Worker does not enable CORS.

## Routes

| Method | Path | Authentication and behavior |
| --- | --- | --- |
| `POST` | `/v1/decisions` | Kaseki only. Accepts bounded dynamic JEV questions for trusted Kaseki workloads. |
| `POST` | `/v1/profiles/{profileId}/evaluate` | Bearer authenticated. Checks profile permission before reading evidence or calling JEV. |
| `GET` | `/v1/profiles` | Bearer authenticated. Lists only profiles the identity may invoke. |
| `GET` | `/v1/profiles/{profileId}` | Bearer authenticated. Returns the permitted profile's input and output JSON Schemas and limits. A known but forbidden profile returns 403 without its details. |
| `GET` | `/openapi.json` | Bearer authenticated. Returns a deterministic OpenAPI 3.1 document filtered to the caller's allowed profiles. |
| `GET` | `/utcp` | Bearer authenticated. Returns the UTCP 1.1 manual filtered to the caller's allowed profiles. |
| `GET` | `/healthz` | Public liveness response; no configuration or provider call. |
| `GET` | `/readyz` | Public readiness response; no provider call or secret disclosure. |

Wrong methods return 405 with `Allow`. Unknown routes return 404.

## Machine identity and permission matrix

The Worker authenticates `Authorization: Bearer <token>` against two separate secrets:

| Identity | Secret | Generic decisions | Permitted profiles |
| --- | --- | --- | --- |
| Kaseki | `SENKU_KASEKI_API_TOKEN` | Yes | `task_admission_v1`, `validation_recovery_v1` |
| Soyuz | `SENKU_SOYUZ_API_TOKEN` | No | `run_operations_triage_v1`, `kaseki_output_review_v1`, `kaseki_output_review_v2` |

Both values must be configured, valid, and different. Each is 32–1,024 printable ASCII characters without whitespace. An absent, malformed, or duplicated credential configuration fails closed for all bearer-authenticated operations; readiness is false. Token comparison uses SHA-256 digests and a fixed-length byte loop. Credentials are never logged or returned.

Identity is established only from the authenticated token. Senku ignores client identity supplied in JSON, query parameters, or headers. The HTTP layer exposes an internal `resolveIdentity` dependency for future trusted server-derived identity, so a Service Binding integration need not change the profile engine. That seam is not populated from caller-controlled request data. A Service Binding by itself grants no profile permission.

The authoritative policy lives in `src/auth/permissions.ts`. Registry metadata and discovery are derived from that policy rather than a second client list.

## Profile evaluation

`POST /v1/profiles/{profileId}/evaluate` accepts JSON with this envelope:

```json
{
  "schemaVersion": "1",
  "input": {
    "run": {
      "status": "failed",
      "stage": "validation",
      "operationalHealth": "suspect_stalled",
      "failureClass": "provider_failure",
      "createdAt": "2026-11-08T12:00:00.000Z",
      "queuedAt": "2026-11-08T12:00:01.000Z",
      "startedAt": "2026-11-08T12:00:02.000Z",
      "completedAt": "2026-11-08T12:00:03.000Z",
      "lastHeartbeatAt": "2026-11-08T12:00:02.500Z"
    }
  }
}
```

The `input` object must match the selected profile's exact contract. Unknown fields are rejected. Callers provide evidence, never JEV questions, instructions, model names, or provider URLs. See [PROFILES.md](PROFILES.md) and the authenticated `/v1/profiles/{profileId}` route for full schemas.

Successful evaluations return the same envelope shape for every profile:

```json
{
  "schemaVersion": "1",
  "requestId": "dec-00000000-0000-4000-8000-000000000000",
  "status": "completed",
  "profileId": "run_operations_triage_v1",
  "profileVersion": "1",
  "provider": "jev",
  "model": "typesafe/jev-resolved-version",
  "answers": {},
  "result": {},
  "usage": { "input_tokens": 120 },
  "durationMs": 840,
  "attemptCount": 1
}
```

`usage` is omitted when the provider supplies none. `result` retains the profile's canonical answer map and duplicates `answers` for a stable envelope. Canonical choice and score answers support `confidence: null`; NouL answers always have null confidence because that result type does not carry a separate confidence value. The API never substitutes a guessed confidence.

The server validates evidence, builds the fixed profile questions, makes exactly one provider attempt, validates all returned answer keys and values, and only then returns a successful assessment. Errors never contain raw evidence, question prompts, provider responses, credentials, or stack traces. Failures do not produce a successful `result`.

## Discovery and OpenAPI

`GET /v1/profiles` returns:

```json
{
  "schemaVersion": "1",
  "profiles": [
    {
      "id": "run_operations_triage_v1",
      "version": "1",
      "name": "Run operations triage",
      "description": "Assess retained Kaseki run operational metadata using Soyuz's approved projection.",
      "owner": "soyuz",
      "questionCount": 3,
      "maxEvidenceBytes": 12288,
      "operations": ["evaluate"]
    }
  ]
}
```

The list is filtered by the central permission policy. Profile contracts contain identity/version, description, input schema, output schema, request/evidence/question limits, and the evaluation endpoint. They omit internal JEV question text, provider credentials, and infrastructure configuration.

`GET /utcp` applies the same authenticated identity filter and returns one native HTTP tool per permitted profile. Its manual version is `1.0.0`; its UTCP protocol version is `1.1`. Each tool calls `POST /v1/profiles/{profileId}/evaluate` directly and maps the complete `{ "schemaVersion": "1", "input": ... }` request from the tool's `request` argument using `body_field: "request"`. Senku does not expose the generic `/v1/decisions` endpoint in the manual. The manual is generated from the registry, includes a client-side bearer-variable placeholder, uses the configured trusted `SENKU_PUBLIC_BASE_URL`, and never calls the provider. The response is `no-store`. See [UTCP.md](UTCP.md) for verified reference-client behavior.

`GET /openapi.json` builds OpenAPI 3.1 from profile-owned input JSON Schemas, response schemas derived from the server-owned question maps, shared request/answer/error contracts, and implemented routes, including `/utcp`. The authenticated document includes only the profile contracts and UTCP tools available to that identity. Kaseki's document includes `POST /v1/decisions`; Soyuz's does not advertise an operation it cannot use. Structural, route, reference, permission, schema/runtime parity, and independent Redocly OpenAPI validation run offline.

## Generic decisions

`POST /v1/decisions` retains the Phase 1 contract:

```json
{
  "schemaVersion": "1",
  "state": { "status": "failed", "exitCode": 1 },
  "questions": {
    "likely_transient": {
      "type": "noul",
      "instructions": "Does the evidence suggest a transient failure?"
    }
  }
}
```

Question types are `noul`, `choice`, and `score`. The generic endpoint remains Kaseki-only even though Soyuz has its own profile token. It is intended for trusted internal workloads and is not an open public classifier.

## Bounds and errors

The streamed request body limit is 128 KiB; the provider response limit is 64 KiB. Global limits include 64 questions, 12 options per choice or score, content depth 24, 8,192 content nodes, and 16 KiB per instruction. Each profile has a smaller projected-evidence cap documented in [PROFILES.md](PROFILES.md).

Errors use the established envelope:

```json
{
  "error": {
    "code": "FORBIDDEN",
    "message": "The authenticated client is not permitted to use this endpoint.",
    "retryable": false,
    "requestId": "dec-00000000-0000-4000-8000-000000000000"
  }
}
```

| Internal condition | HTTP | Public code |
| --- | ---: | --- |
| Malformed request, invalid profile input, or unsupported schema version | 400 | `INVALID_REQUEST` or `UNSUPPORTED_SCHEMA_VERSION` |
| Missing or invalid bearer token | 401 | `UNAUTHENTICATED` |
| Authenticated identity lacks permission | 403 | `FORBIDDEN` |
| Unknown route | 404 | `NOT_FOUND` |
| Unknown or unauthorized profile ID | 403 | `FORBIDDEN` |
| Request or profile evidence over its limit | 413 | `PAYLOAD_TOO_LARGE` |
| Invalid service configuration | 503 | `NOT_CONFIGURED` |
| Invalid provider response/profile output | 502 | `INVALID_PROVIDER_RESPONSE` |
| Provider unavailable | 502 | `PROVIDER_UNAVAILABLE` |
| Provider timeout | 504 | `PROVIDER_TIMEOUT` |
| Unexpected internal failure | 500 | `INTERNAL_ERROR` |
| Wrong HTTP method | 405 | `INVALID_REQUEST` plus `Allow` |

Provider errors preserve their retryable classification. No automatic retry is performed.

## Provider and deployment behavior

Senku always sends one request to the fixed OpenRouter Decisions API endpoint and uses only `~typesafe/jev-latest`. It returns the resolved model identifier from OpenRouter. Model selection, endpoint, identity, question map, and provider credential are never caller-controlled. The dedicated Senku OpenRouter key should have a provider-side spending limit; its configuration has not been verified here.

The Worker remains stateless and uses one provider subrequest per evaluation. `/readyz` checks both machine tokens, distinctness, the trusted UTCP public origin, provider configuration, model alias, and timeout range without contacting OpenRouter. Phase 2D production deployment and live verification have not been completed; see [the Phase 2D deployment status](PHASE-2D-DEPLOYMENT.md). Soyuz's Service Binding client uses these same authenticated REST contracts.
