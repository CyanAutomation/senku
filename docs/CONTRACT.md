# REST API contract

This document describes the public request and response shape. The service origin and environment-specific settings are intentionally omitted; consumers use the origin provided for their own environment.

## Routes

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/v1/profiles` | List the profiles available to the caller. |
| `GET` | `/v1/profiles/{profileId}` | Read the public contract for one available profile. |
| `POST` | `/v1/profiles/{profileId}/evaluate` | Validate an input and evaluate the selected profile. |
| `GET` | `/openapi.json` | Read the OpenAPI document projected for the caller. |
| `GET` | `/utcp` | Read the caller-specific tool manual. |
| `GET` | `/healthz` | Check whether the Worker is responding. |
| `GET` | `/readyz` | Check whether the Worker is ready to handle requests. |

## Evaluation

Evaluation requests use JSON and identify a versioned profile in the path. The body supplies the supported schema version and a profile-specific input object. The response follows the selected profile's published output schema.

The profile registry is the source of truth for input validation, output contracts, and profile metadata. The generated contract artifact provides a stable, reviewable snapshot for clients.

## Caller access

The service applies its configured caller policy before returning profile metadata or evaluating a request. Each caller receives only the operations and profiles assigned by the environment's policy. Callers cannot submit arbitrary instructions or choose an upstream destination through the evaluation input.

## Responses and failures

Successful evaluations return a typed result with request metadata. Invalid requests, unavailable profiles, rejected callers, admission limits, timeouts, and upstream failures use bounded error responses with a stable error code and correlation identifier. Responses do not include raw upstream payloads or credential values.

Clients must validate the required fields they consume and ignore unknown top-level response fields. The `attemptCount` is a positive integer and may be greater than one when Senku performs its bounded provider rate-limit retry. Existing required fields and their meanings remain stable within schema version `1`; removals, renames, or incompatible meaning changes require a new version. Nested answer objects remain strict and must match the selected profile contract.

Protected API requests may include `X-Correlation-Id` (1–128 characters, starting with an ASCII letter or digit and then limited to letters, digits, `.`, `_`, `:`, `/`, and `-`) and `X-Senku-Deadline-Ms` (a 13-digit absolute Unix timestamp in milliseconds). Senku returns the correlation value in structured logs; success and error envelopes include the server-generated `requestId`.

## Resilience boundaries

The provider adapter isolates external transport from profile evaluation. Request deadlines, bounded retry behavior, circuit breaking, and admission controls protect the Worker from unbounded work. Provider-specific addresses and environment settings are maintained outside this public contract.

See [Resilience and operations](RESILIENCE-OPERATIONS.md) for the exact retry limits, deadline interpretation, Cloudflare admission-control limits, and operational gates.

## Compatibility

Profile identifiers and schema versions are part of the client contract. Add a new profile version when an incompatible input or output change is needed; keep existing versions available according to the project's compatibility policy. Regenerate and check the profile artifact whenever the registry changes.
