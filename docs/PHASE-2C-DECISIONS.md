# Phase 2C implementation decisions

## Scope and versions

Phase 2C adds authenticated, identity-filtered UTCP discovery for Senku's five existing profile REST routes, confirms real client invocation, and completes independent OpenAPI validation and discovery performance measurements. It does not change the profile engine, add an inference endpoint, modify Soyuz or Kaseki-Agent, deploy the Worker, or add persistence.

The selected stable UTCP protocol version is `1.1`; Senku's independently versioned manual is `1.0.0`. The official published TypeScript packages used in tests are `@utcp/sdk` `1.2.0` and `@utcp/http` `1.1.14`. Independent OpenAPI validation uses development-only `@redocly/openapi-core` `2.77.0`.

The manual has the modern structure `utcp_version`, `manual_version`, and `tools`. The actual published SDK's `UtcpManualSchema` accepts and parses this shape. The HTTP plugin's serialized template validates API-key authentication with `api_key`, `var_name`, and `location`, and executes JSON body mapping through `body_field`. The plugin README's `api_key_value`/`in` example is stale for package 1.1.14; its installed serializer and runtime use the fields Senku publishes.

## Identity and request mapping

The central permission policy remains authoritative. Kaseki receives `assess_task_admission` and `assess_validation_recovery`; Soyuz receives `triage_run_evidence`, `review_kaseki_output_v1`, and `review_kaseki_output_v2`. Each maps to the corresponding existing `POST /v1/profiles/{profileId}/evaluate` route. No generic decision tool is exposed.

Tool inputs wrap the existing complete versioned request under `request`; each HTTP template sets `body_field: "request"`. The official client test verifies that the server receives exactly the contained JSON value, including `schemaVersion`, profile-specific `input`, and no outer wrapper or query parameters. The same bearer token authenticates manual discovery and route invocation. Tokens remain client variables and are substituted into the Authorization header by the published client.

`SENKU_PUBLIC_BASE_URL` is the trusted non-secret origin used to construct concrete profile URLs. The Worker validates it, allows HTTPS for non-local services and loopback-only HTTP for local development, and rejects credentials, search, fragments, and non-root paths. It does not use Host or forwarded-host headers. Invalid or absent configuration fails closed for readiness and manual generation.

## Schema projection and client limits

The registry's existing input schema and canonical response schema remain the source of truth. UTCP publishes the full versioned request envelope and response envelope. The projection retains standard schema keywords and nested structures, including enums, const values, nullable types, and output unions. It removes Senku-specific `x-` extensions, converting byte, URL, probability, depth, and node restrictions into descriptions while the existing server validator continues enforcing them. Unresolved `$ref` values are rejected; current profile contracts need no references.

The official SDK declares its `JsonSchema` shape as draft-07-based and accepts arbitrary additional keywords. `UtcpManualSchema` structurally parses the manual; it is not a full JSON Schema 2020-12 semantic validator, and the HTTP client does not validate invocation arguments before sending them. Tests therefore compare each projected tool schema with the existing profile registry, parse manuals using the official SDK, and exercise the real invocation route. Senku runtime validation remains authoritative. Clients that require complete 2020-12 evaluation should use a separate compatible validator and still handle Senku's server response.

## OpenAPI generation and validation

OpenAPI components are built once per identity document rather than repeatedly during one build. The two documents and their serialized JSON are bounded, cached by identity, and deep-frozen to prevent cross-identity mutation. UTCP serialized manuals are cached by identity and validated origin; projected schemas are cached by the five fixed profile IDs. No distributed cache is required.

`npm test` runs the Cloudflare Worker suite and then a separate Node test project using Redocly's OpenAPI 3.1 validator. It validates the complete Kaseki and Soyuz documents offline, with no warnings or errors. Existing route, reference, security, schema, and permission tests remain in place.

## Verification results

All interoperability requests use distinct synthetic machine credentials and a mocked provider response. The official `UtcpClient` fetches `/utcp`, discovers exactly two Kaseki tools or three Soyuz tools, and successfully invokes one tool under each identity. Senku runs in the Cloudflare Vitest/workerd runtime; a test-only fetch bridge routes the official client's local HTTP calls into the Worker, while the provider is mocked independently. The bridge is not part of the product. Tests confirm the concrete profile route, bearer header, JSON content type, exact body, REST success envelope, and one mocked provider call per evaluation. Discovery produces zero provider calls. Forbidden cross-identity calls, unauthenticated discovery and invocation, invalid configuration, unsupported versions, malformed input, oversized input, host-header injection, and invalid body mapping are checked without provider inference.

The tests also confirm that neither configured machine token nor the OpenRouter key appears in the manual. Senku response bodies and routine logs remain evidence-free. The official HTTP client's own error logger may print its local Axios request configuration when a client invocation fails; applications should configure their logging policy accordingly and avoid logging sensitive UTCP arguments. Senku's server responses and logs do not expose that request content.

### Discovery, contracts, and bundle

The following values are measured with Node 26.13.0 from the local Workers runtime using `npm run perf:smoke` and the Wrangler dry-run build. Timings are local wall time and do not establish Cloudflare billed CPU. Warm times shown as below timer resolution are rounded to zero by the test runtime.

| Identity | Endpoint | Cold wall time | Warm average | Response size |
| --- | --- | ---: | ---: | ---: |
| Kaseki | `/utcp` | 3 ms | below timer resolution | 20,015 bytes |
| Soyuz | `/utcp` | 1 ms | below timer resolution | 25,757 bytes |
| Kaseki | `/openapi.json` | 3 ms | 0.50 ms | 62,564 bytes |
| Soyuz | `/openapi.json` | 1 ms | 0.25 ms | 74,879 bytes |

Additional profile discovery sizes: Kaseki `/v1/profiles` 603 bytes, task-admission contract 6,249 bytes, validation-recovery contract 2,977 bytes; Soyuz `/v1/profiles` 824 bytes, run-triage contract 3,985 bytes, output-review v1 3,406 bytes, and output-review v2 4,433 bytes. Discovery and contract generation made zero provider calls.

One official-client invocation sample measured 30 ms for Kaseki and 4 ms for Soyuz, each with one mocked provider call. The Kaseki measurement was the first tool invocation in that client run; Soyuz followed after the HTTP plugin had already made a call. These are local single-sample end-to-end wall times, rounded to milliseconds, and do not represent billed CPU or a stable latency guarantee. The performance command serializes the two test files to reduce cross-test contention.

The Wrangler dry-run reported a 114.02 KiB upload and 24.12 KiB gzip bundle. The UTCP SDK, HTTP plugin, and Redocly validator are development dependencies and are not bundled into the Worker. No allocation profiler was used; cold/warm wall-time comparisons and generated sizes are the local efficiency measurements available here.

## Security and operational policy

UTCP metadata does not expand Senku's authority. The tools are advisory; consumer deterministic controls remain authoritative. The manual contains only fixed routes for profiles visible to the authenticated identity. No OpenRouter URL, model selector, question definition, arbitrary destination, persistent registry, MCP route, or Service Binding is added.

Senku continues using only `~typesafe/jev-latest`, one provider attempt per evaluation, and the existing Cloudflare Worker limits. A dedicated OpenRouter key should have provider-side spending controls; this implementation did not verify that such a limit is configured. No live inference, deployment, or change to related repositories occurred.

## Remaining work

Before deployment, an operator must configure `SENKU_PUBLIC_BASE_URL` to the intended HTTPS hostname, configure distinct valid Kaseki and Soyuz machine secrets and the Senku OpenRouter key, confirm provider-side spending limits, and inspect `/readyz` plus both identity-filtered manuals. Phase 3 remains the separate Soyuz Service Binding and consumer-integration work, followed by the Kaseki remote decision adapter in Phase 4. Soyuz-owned run-management UTCP remains in the Soyuz repository.
