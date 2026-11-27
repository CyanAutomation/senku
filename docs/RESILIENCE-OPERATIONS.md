# Resilience and operations

This document describes the current runtime behavior. The phase decision records preserve their original implementation scope; use this page and the API contract for current behavior.

## Deadlines and correlation

Protected API callers can send `X-Correlation-Id` and `X-Senku-Deadline-Ms`. Senku accepts a correlation ID of 1–128 ASCII characters matching `[A-Za-z0-9][A-Za-z0-9._:/-]*`; an invalid supplied value receives a 400 response. If omitted, Senku uses its generated request ID as the correlation value. The response's `requestId` is always a server-generated `dec-<uuid>` value; it differs from the correlation ID when the caller supplied one. Send a stable correlation ID from the consumer so it is available in Senku logs even if the caller times out before receiving a response.

`X-Senku-Deadline-Ms` is an absolute Unix timestamp in milliseconds, encoded as exactly 13 decimal digits. If supplied in another format, Senku rejects the request. After request parsing and validation, Senku clamps provider time to the smaller of the configured timeout and the remaining caller deadline. The configured timeout defaults to 15 seconds and accepts 1–30 seconds. If less than one second remains, Senku returns `PROVIDER_TIMEOUT` without contacting the provider. Consumers should leave time beyond the propagated provider deadline for transport, Worker processing, response validation, and local cleanup; an HTTP timeout that equals the provider budget can still fire first.

The correlation ID and deadline are headers on the protected Senku API. They are not authentication values. Keep machine credentials in the Authorization header and out of logs and URLs.

## Provider retry and errors

Provider requests use the fixed deployment-configured HTTPS endpoint and an allowlisted model. Senku makes at most two provider attempts for one profile evaluation:

- The first `429` response is retried once only when `Retry-After` parses as a bounded value of at most two seconds and enough provider deadline remains for the wait plus at least one second of provider time.
- Transport failures, timeouts, `408`, `425`, `5xx`, malformed responses, and all other statuses are not retried internally.
- A final provider `429` is returned as HTTP 429 with `PROVIDER_RATE_LIMITED`; other retryable provider HTTP failures use `PROVIDER_UNAVAILABLE`. The safe response may include a bounded `Retry-After` header.
- The successful envelope's `attemptCount` is the actual number of provider fetches and can be 1 or 2. A circuit-breaker rejection or an already-expired deadline can report zero in logs because no provider fetch occurred.

`RATE_LIMITED` is the Senku admission-control response. `PROVIDER_RATE_LIMITED` is the upstream provider response. Consumers should keep these categories distinct and avoid multiplying retries across Senku and caller layers.

The provider circuit breaker is in-memory and per Worker isolate. It opens after three consecutive retryable provider failures for ten seconds, allows one probe after the interval, and closes on success. Cloudflare may run many isolates, so this is best-effort reduction of repeated work rather than a shared outage limit.

## Admission control and public ingress

`wrangler.jsonc` binds a Cloudflare rate limit of 120 requests per minute per IP and 60 per minute per authenticated identity. The bindings cover protected API routes. Cloudflare's [Workers rate-limit binding](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/) is approximate and location-local; counters update asynchronously. It is not a strict global quota, concurrency limit, or provider-spend control. Configure a provider-side spending allowance independently.

The Worker currently has `workers_dev: true` and `preview_urls: false`. Keep the public `workers.dev` hostname while remote consumers depend on it. When all consumers use another verified ingress, disable `workers_dev` in Wrangler source configuration and deploy that change; a dashboard-only change can be reversed by the next Wrangler deployment. See Cloudflare's [workers.dev routing guidance](https://developers.cloudflare.com/workers/configuration/routing/workers-dev/).

## Credentials and rotation

Kaseki uses `SENKU_KASEKI_API_TOKEN` and optional `SENKU_KASEKI_API_TOKEN_NEXT`; Soyuz uses `SENKU_SOYUZ_API_TOKEN` and optional `SENKU_SOYUZ_API_TOKEN_NEXT`; Rusty-Fossil uses `SENKU_RUSTY_FOSSIL_API_TOKEN` and optional `SENKU_RUSTY_FOSSIL_API_TOKEN_NEXT`. Kaseki and Soyuz each require a distinct 32–1,024 byte printable-ASCII token. Rusty-Fossil has a separate optional identity. All configured current and next tokens must be valid and distinct across identities; a next token requires its current token to be configured. Kaseki and Soyuz current tokens are required for readiness, while Rusty-Fossil is optional.

Rotate without a lock-step deployment: configure a distinct next token on Senku, distribute that value to the consumer, allow the consumer to switch, then promote it to the current secret and remove the old value. Check readiness after each Senku secret change. Never put token values in source, GitHub variables, task output, or logs.

## Readiness and telemetry

`/healthz` checks that the Worker responds. `/readyz` checks machine-token structure and distinctness, `SENKU_PROVIDER_REQUEST_URL`, `SENKU_PROVIDER_AUTHORIZATION`, `JEV_MODEL`, `SENKU_PROVIDER_TIMEOUT_MS`, rate-limit bindings, and timeout syntax. It does not call the provider or validate `SENKU_PUBLIC_BASE_URL`. UTCP manual generation requires that trusted origin separately; this keeps discovery URL configuration from determining whether evaluation is ready.

Worker logs use `head_sampling_rate: 1.0`; traces use `head_sampling_rate: 0.01`. Logs contain operational metadata such as identity, profile, model, request/correlation IDs, status, timings, usage, and attempt counts, not prompts, evidence, answers, credentials, or provider bodies. Review account log-retention and ingestion limits before relying on ongoing full log capture. Trace sampling remains independent of log sampling. See Cloudflare's [Workers Logs guidance](https://developers.cloudflare.com/workers/observability/logs/workers-logs/).

## Provider canary

`.github/workflows/provider-canary.yml` is scheduled daily at 03:17 UTC and can also be dispatched manually. It runs only when repository variable `SENKU_CANARY_ENABLED` and `SENKU_CANARY_BUDGET_CAPPED` are both `true`, requires `SENKU_CANARY_EXPECTED_MODEL`, and uses the provider request URL and authorization from the dedicated `SENKU_CANARY_PROVIDER_REQUEST_URL` and `SENKU_CANARY_PROVIDER_AUTHORIZATION` secrets. `SENKU_CANARY_MODEL` may select one of the allowlisted models; otherwise it uses the default alias. The smoke test makes one synthetic provider request and fails if the resolved model differs from the expected value.

The workflow gate records an operator attestation; it does not inspect or enforce an OpenRouter spending cap. Confirm a provider-side cap for the dedicated canary credential before setting the gate variables or dispatching the workflow. The normal mocked CI suite never calls the live provider.

## Contract and generated artifact

Senku owns profile questions and schemas. `npm run contracts:generate` regenerates `contracts/senku-profiles.v1.json`, and `npm run contracts:check` verifies it matches the registry. Each consumer checks in the generated artifact with its source revision and SHA-256 pin; consumer CI verifies that local artifact has not drifted. Review contract changes before updating those pins. Additive response-envelope fields are compatible; changes to required fields, meanings, or answer contracts require a new schema version.
