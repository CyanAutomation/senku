# Phase 1 implementation decisions

## Consumer contract reconciliation

Senku accepts Kaseki's structured object state as well as Soyuz's string state. Its question content supports Kaseki's string, object, and array values, including null choice descriptions. NouL criteria are optional and may contain either binary side. This is broader than Soyuz's current text-only question shape.

Soyuz's current schema limits a request to 16 questions and 12 options per question. Kaseki's Goal Check creates an additional applicability question for each conditional success criterion and does not enforce a total question count. Senku therefore uses a 64-question cap, four times Soyuz's existing limit, alongside the 128 KiB request limit. This is a documented service boundary: a Kaseki request larger than that must be reduced or split by a future adapter. The 12-option and 12-score-level caps preserve the current Soyuz bound and cover the inspected Kaseki task-admission and run-evaluation definitions.

The canonical response keeps provider-resolved model and returned token usage. It reports one provider attempt, maps provider duration to durationMs, and retains the typed answer map. To satisfy Soyuz's normalized NouL shape, Senku derives the false probability as 1 minus noul and reports confidence as null. Choice and score confidence can also be null when OpenRouter omits it. A score legend is checked against the requested string scale when returned, or reconstructed from that scale when omitted. Future adapters need to account for the nullable confidence against Kaseki's current required-number type; Kaseki's responseTime maps from durationMs.

The checked-in fixtures in test/fixtures/kaseki-request.ts and test/fixtures/soyuz-request.ts are small sanitized representations of the two request styles. They do not include real run IDs, repositories, source code, or credentials. No Kaseki-Agent or Soyuz files were changed.

## Validation choices

- Strict version 1 envelope with no caller-selected model or provider.
- Maximum body 128 KiB, enforced on the streamed body even when Content-Length is absent or false.
- Maximum 64 questions, 12 options per question, 12 score levels, depth 24, 8,192 traversed content nodes, and 16 KiB per instruction or description string.
- Probability values must be finite and between 0 and 1; choice and score distributions must contain exactly the expected keys and sum to one within 0.03.
- Choice labels must exist in the caller's criteria. Score values must be finite and within the declared index range. Returned string legends must match the caller's declared string criteria.
- Provider responses are streamed with a 64 KiB cap. Unknown answer fields, missing answers, extra answers, wrong types, and malformed usage are rejected.
- Upstream NouL only supplies its positive probability, so the complement in the response is a deterministic normalization, not a second model estimate.

## Runtime and dependency choices

The application has no runtime npm dependencies. Handwritten validation keeps the shipped Worker small and avoids a validation framework in a latency-sensitive request path. Wrangler, TypeScript, Vitest, and @cloudflare/vitest-plugin are development-only dependencies.

Node.js 26 is pinned as the local and CI tooling major through .nvmrc, .node-version, package engines, and GitHub Actions. The deployed Worker uses Web APIs only and does not enable nodejs_compat.

Cloudflare's current documentation lists the Workers Free limits as 10 ms CPU per request, 100,000 requests per day, 128 MiB memory, and 50 external subrequests per request. The Worker is configured for a 10 ms CPU ceiling and one subrequest; one request is used only for the fixed OpenRouter call. The Worker does not persist an in-memory or global spend counter, which could not provide a reliable account-wide budget.

Cloudflare recommends @cloudflare/vitest-plugin for tests that run in the Workers runtime. The integration and provider adapter are tested offline. Wrangler's build command is a dry run and does not publish a Worker.

## Provider, authentication, and cost policy

The adapter calls the fixed OpenRouter Decisions API endpoint, rejects redirects, uses the OPENROUTER_API_KEY Worker secret, and never accepts a model or destination from the caller. The model is fixed to the exact alias `~typesafe/jev-latest`. If `JEV_MODEL` is set, it must match that alias; a stable model identifier is not accepted.

The generic route is authenticated with `SENKU_KASEKI_API_TOKEN`. Authentication occurs before content-type checking and request parsing. The token must be 32–1,024 printable ASCII characters with no whitespace; configuration is not trimmed. Token digests are compared using a fixed-length byte loop. The authenticated identity is labelled `kaseki`. Phase 2A adds a central profile permission policy and internal `soyuz` identity for the three Soyuz-owned profiles, but no Soyuz credential or Service Binding transport exists. Service Binding access alone would not grant permission.

Automatic retries are disabled to avoid multiplying inference cost. Timeouts, transport errors, and transient provider status codes are classified retryable for an external caller to decide. Per-request size, count, attempt, and timeout limits are not a global inference-spend cap.

Routine logs contain request ID, client label, outcome, model, counts, sizes, duration, attempt count, and available token usage. They exclude prompts, state, answer payloads, provider bodies, credentials, and authorization headers.

## Deferred work

At the Phase 1 baseline, decision profiles, profile-level authorization, and a Soyuz identity were deferred. Phase 2A now implements the internal versioned profile registry and consumer-specific permission policy. Public profile HTTP routes, Soyuz authentication and Service Binding transport, consumer adapters, OpenAPI generation, UTCP, persistence, quotas, a dashboard, and production deployment remain deferred. The Soyuz MCP-to-UTCP migration remains in Soyuz.

## Measurements and limits

The perf:smoke command recorded these local workerd elapsed times across three runs per payload:

| Scenario | Request size | Average wall time | Maximum wall time |
| --- | ---: | ---: | ---: |
| Small | 172 B | 0.67 ms | 2 ms |
| Typical | 3,882 B | 0.33 ms | 1 ms |
| Upper bound | 131,072 B | 0.67 ms | 1 ms |

These are local wall-clock measurements, not Cloudflare billed CPU time. Wrangler's dry-run reported a 27.48 KiB uncompressed bundle and 6.46 KiB gzip bundle. No local tool can guarantee deployed Free-plan CPU consumption; use Cloudflare invocation CPU metrics after a deployment is separately approved.

Cloudflare Free hosting does not limit OpenRouter spending. A global spending budget requires provider-side controls or persistent coordination and is outside Phase 1.

## Source references checked on 2026-11-08

- [Cloudflare Workers limits](https://developers.cloudflare.com/workers/platform/limits/)
- [Cloudflare Workers Vitest integration](https://developers.cloudflare.com/workers/testing/vitest-integration/)
- [OpenRouter Decisions API reference](https://openrouter.ai/docs/api/api-reference/alphadecisions/submit-a-decisions-request)
- [OpenRouter Jev 1.14 guide](https://openrouter.ai/blog/insights/what-is-jev/)
- [Node.js release schedule](https://nodejs.org/en/about/previous-releases)
