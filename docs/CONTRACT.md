# HTTP contract

The HTTP surface remains the three routes below. Phase 2A adds a typed, versioned profile engine for internal callers, but does not expose profile evaluation or discovery over HTTP. The five registered profiles and their contracts are documented in [PROFILES.md](PROFILES.md).

## Routes

| Method and path | Authentication | Success |
| --- | --- | --- |
| GET /healthz | None | 200 with { "status": "ok" } |
| GET /readyz | None | 200 with { "status": "ready" } or 503 with { "status": "not_ready" } |
| POST /v1/decisions | Bearer token | 200 with a completed version 1 decision response |

The generic decision endpoint authenticates the Kaseki machine identity using `SENKU_KASEKI_API_TOKEN`. It does not authorise Soyuz or browser callers. The configured token must be 32–1,024 printable ASCII characters with no whitespace; malformed configuration fails closed and makes readiness return `not_ready`. The internal profile engine separately checks the supplied machine identity against each profile's owner policy before input validation or provider invocation. Only Kaseki is currently authenticated by the Worker. The OpenRouter credential is never sent to a client. No CORS headers are enabled.

Wrong methods on known routes return 405 and an Allow header. Unsupported paths return 404. Health and readiness never call the provider. Readiness checks that authentication, provider credentials, the exact configured model alias, and the timeout have valid configuration; it returns no settings or secrets.

## Request

Requests must use Content-Type application/json and the following exact top-level fields:

    {
      "schemaVersion": "1",
      "state": "or a bounded JSON object",
      "questions": {
        "failure_cause": {
          "type": "choice",
          "instructions": "Classify the likely failure.",
          "criteria": {
            "transient": "Temporary environment issue",
            "code_defect": "Application code defect",
            "unknown": null
          }
        },
        "safe_to_retry": {
          "type": "noul",
          "instructions": "Is this failure likely transient?"
        },
        "completion": {
          "type": "score",
          "instructions": "How complete is the result?",
          "criteria": ["not complete", "partly complete", "complete"]
        }
      }
    }

The request fields are strict. A caller cannot choose the model or provider. Senku always sends the exact model alias `~typesafe/jev-latest`. If `JEV_MODEL` is set, it must equal that exact value. OpenRouter may resolve the alias to a different dated model over time; the response retains that resolved identifier. Schema version 1 accepts:

- State as a non-empty string or a JSON object. The Soyuz string state and Kaseki structured object state are both supported.
- One to 64 questions. IDs match lowercase letters, digits, and underscores, starting with a letter and no longer than 64 characters.
- NouL with non-empty instructions and optional binary criteria. Criteria may contain either or both of true and false. This supports Kaseki's optional and partial binary criteria.
- Choice with two to 12 options. Option IDs use the same restricted identifier form as question IDs. Descriptions may be strings, arrays, or objects; null descriptions are accepted for Kaseki compatibility.
- Score with two to 12 ordered levels. A level may be a string, array, or object.
- Instructions and structured content are bounded by the total request size, a 16 KiB per-string limit, a nesting depth of 24, and a combined 8,192-node validation budget.

The Worker reads the stream and enforces a 128 KiB UTF-8 request-body limit even when Content-Length is missing or inaccurate. It also checks Content-Length early when present. Malformed JSON, unsupported types, invalid identifiers, extra fields, and out-of-range counts are rejected before inference.

## Response

Completed responses use this envelope:

    {
      "schemaVersion": "1",
      "requestId": "dec-00000000-0000-4000-8000-000000000000",
      "status": "completed",
      "provider": "jev",
      "model": "typesafe/jev-1.14-20261014",
      "answers": {
        "safe_to_retry": {
          "type": "noul",
          "noul": 0.91,
          "probabilities": { "false": 0.09, "true": 0.91 },
          "confidence": null
        },
        "failure_cause": {
          "type": "choice",
          "choice": "transient",
          "probabilities": {
            "transient": 0.94,
            "code_defect": 0.04,
            "unknown": 0.02
          },
          "confidence": 0.94
        },
        "completion": {
          "type": "score",
          "score": 1.9,
          "legend": {
            "0": "not complete",
            "1": "partly complete",
            "2": "complete"
          },
          "probabilities": { "0": 0.01, "1": 0.08, "2": 0.91 },
          "confidence": 0.91
        }
      },
      "usage": { "input_tokens": 420, "output_tokens": 30 },
      "durationMs": 850,
      "attemptCount": 1
    }

The resolved provider model is retained from the provider response. NouL probabilities are derived deterministically from the provider's noul probability; confidence is null because the provider does not supply a separate NouL confidence. Missing or explicitly null choice/score confidence is represented as null. If the provider omits a score legend, Senku reconstructs it from the declared score criteria. The choice and score probability distributions are validated against the requested keys and must sum to 1 within 0.03.

Usage is optional and is only returned when supplied by OpenRouter. Senku preserves supported `input_tokens`, `output_tokens`, `total_tokens`, and `cost` values; it never estimates missing counts or costs. `durationMs` measures the provider call and response validation. The provider attempt count is always one. A future Kaseki adapter maps `durationMs` to its `responseTime` field and must represent nullable choice/score confidence.

OpenRouter's optional request-level `annotations` array is accepted only as bounded JSON source objects and discarded. It is not returned, logged, or persisted. The whole provider response remains limited to 64 KiB; annotations have an additional 32-object and 16 KiB JSON limit. The top-level provider response validator continues to reject unknown fields.

All responses include Cache-Control: no-store. Provider errors are never returned as completed answers.

## Errors

Errors use this envelope:

    {
      "error": {
        "code": "PROVIDER_UNAVAILABLE",
        "message": "The decision provider is unavailable.",
        "retryable": true,
        "requestId": "dec-00000000-0000-4000-8000-000000000000"
      }
    }

| Code | HTTP | Retryable policy |
| --- | ---: | --- |
| INVALID_REQUEST | 400, 405, or 415 | No |
| UNAUTHENTICATED | 401 | No |
| FORBIDDEN | 403 | No; identity is authenticated but lacks permission |
| PAYLOAD_TOO_LARGE | 413 | No |
| UNSUPPORTED_SCHEMA_VERSION | 400 | No |
| NOT_CONFIGURED | 503 | No |
| PROVIDER_TIMEOUT | 504 | Yes |
| PROVIDER_UNAVAILABLE | 502 | Yes for network errors, timeouts, 408, 425, 429, or 5xx; otherwise no |
| INVALID_PROVIDER_RESPONSE | 502 | No |
| NOT_FOUND | 404 | No |
| INTERNAL_ERROR | 500 | No |

Public errors do not contain raw provider bodies, caller input, credentials, or stack traces. Request IDs correlate errors with structured logs.

## Provider limits

The Worker sends one request to OpenRouter's fixed Decisions API URL with the server-configured JEV model. The default timeout is 15 seconds; a configured timeout must be from 1,000 to 30,000 ms. Provider response bodies are streamed and capped at 64 KiB. Redirects are rejected. Automatic retries are disabled.

## Internal profile engine

The profile registry is code-owned and contains `run_operations_triage_v1`, `kaseki_output_review_v1`, `kaseki_output_review_v2`, `task_admission_v1`, and `validation_recovery_v1`. Each fixes its input projection, question map, owner, output validator, and evidence-size limit. Callers cannot provide questions, model, or provider URL. Kaseki owns the generic endpoint and the two Kaseki profiles. Soyuz owns the three Soyuz profiles, but a Soyuz credential or Service Binding transport is not implemented. Profile calls use the shared provider adapter once and return typed answers with safe operational metadata. The profiles are internal TypeScript APIs, not HTTP routes; see [PROFILES.md](PROFILES.md) for field-level contracts and deterministic safety boundaries.
