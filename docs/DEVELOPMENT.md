# Development and operations

## Prerequisites and local setup

- Node.js 26 and npm.
- Git.
- No Cloudflare account or OpenRouter credential is needed for typecheck, routine tests, the performance smoke test, or dry-run build.

The Worker uses native Fetch, Request, Response, AbortController, Web Crypto, TextEncoder, and TextDecoder APIs. It does not enable Node.js compatibility in Cloudflare.

```sh
nvm use
npm ci
cp .dev.vars.example .dev.vars
```

`.dev.vars` is ignored by Git. For authenticated local Worker requests, set distinct placeholder or real local values for both `SENKU_KASEKI_API_TOKEN` and `SENKU_SOYUZ_API_TOKEN`. Each must be 32–1,024 printable ASCII characters with no whitespace. Generate them independently with a cryptographically secure source, for example:

```sh
openssl rand -base64 32
```

Do not commit real credentials or paste them into documentation, shell history, source, or Wrangler text variables.

## Commands

```sh
npm run dev
npm run typecheck
npm test
npm run perf:smoke
npm run build
```

The routine test suite uses mocked provider responses and does not incur provider charges. `npm run perf:smoke` exercises the full Worker HTTP path for all five profiles, including large evidence inputs. It reports request size, projected evidence bytes, question count, provider attempts, and local elapsed wall time. It is not a measurement of billed Cloudflare CPU. `npm run build` performs Wrangler's dry-run build, does not deploy, and emits the bundle whose size is recorded separately in the validation report.

The generated OpenAPI document is available at `/openapi.json` when a Worker is running. That route requires one of the configured machine credentials and shows only the authenticated identity's profiles.

### Optional live provider smoke test

The live test is a separate paid inference request. It is excluded from `npm test` and routine CI. Run it only when an operator explicitly wants to verify live OpenRouter compatibility:

```sh
OPENROUTER_API_KEY='<existing Senku OpenRouter key>' npm run smoke:provider
```

It sends one small synthetic decision using `~typesafe/jev-latest`, reports only status, resolved model, duration, and returned usage, and does not retry. Routine CI never makes provider calls.

## Environment and secrets

| Variable | Source | Purpose |
| --- | --- | --- |
| `OPENROUTER_API_KEY` | Local `.dev.vars`; Worker secret | Dedicated Senku provider credential; separate from machine tokens |
| `SENKU_KASEKI_API_TOKEN` | Local `.dev.vars`; Worker secret | Kaseki bearer identity and generic/profile permission |
| `SENKU_SOYUZ_API_TOKEN` | Local `.dev.vars`; Worker secret | Separate Soyuz bearer identity and profile permission |
| `JEV_MODEL` | Wrangler variable; optional local value | Must be exactly `~typesafe/jev-latest`; omission selects that alias |
| `SENKU_PROVIDER_TIMEOUT_MS` | Wrangler variable; optional local override | 1,000–30,000 ms; default is 15,000 ms |

Both machine tokens are required, must satisfy the strong-token format, and must differ. Any missing, invalid, or duplicate token configuration fails closed and makes `/readyz` return `not_ready`. A credential never identifies a caller through the request body, query string, or identity header. No CORS headers are enabled.

For a future deployed Worker, install secrets interactively:

```sh
npx wrangler secret put OPENROUTER_API_KEY
npx wrangler secret put SENKU_KASEKI_API_TOKEN
npx wrangler secret put SENKU_SOYUZ_API_TOKEN
```

No production deployment is part of Phase 2B. Never run `npm run deploy` as part of routine validation.

The model alias remains `~typesafe/jev-latest`; Senku returns the resolved provider model identifier. There is one provider request per evaluation, no retry, no fallback, no per-profile model, and one allowed provider subrequest.

## Example requests

Use placeholder credentials and a sanitized profile input:

```sh
curl http://127.0.0.1:8787/v1/profiles \
  -H 'Authorization: Bearer <SENKU_KASEKI_API_TOKEN>'

curl http://127.0.0.1:8787/v1/profiles/task_admission_v1/evaluate \
  -H 'Authorization: Bearer <SENKU_KASEKI_API_TOKEN>' \
  -H 'Content-Type: application/json' \
  --data '{"schemaVersion":"1","input":{"repoUrl":"https://example.com/repo","taskPrompt":"Add an API endpoint."}}'

curl http://127.0.0.1:8787/openapi.json \
  -H 'Authorization: Bearer <SENKU_SOYUZ_API_TOKEN>'
```

The Soyuz credential cannot call the generic `/v1/decisions` route or inspect Kaseki profile contracts. Kaseki cannot inspect or invoke Soyuz profiles.

## Spending control

The dedicated Senku OpenRouter API key should have a provider-side spending limit. This report does not claim that a limit is configured. Check the key in OpenRouter before any opt-in live smoke test; do not use a Management API key in Senku.

## Cloudflare Free-plan constraints

Senku remains stateless with no D1, KV, R2, Queue, or Durable Object. It uses one outbound provider subrequest per evaluation, fixed URL/model, bounded payloads, and no automatic retries. The Wrangler configuration retains a 10 ms CPU limit. Local performance results are useful for relative comparisons but do not establish production CPU usage; measure deployed CPU only after a separate deployment decision.

## CI and future deployment

CI runs typecheck, tests with mocked provider responses, and Wrangler's dry-run build. No live provider inference runs in CI. Before a future deployment, configure the two distinct machine secrets and the OpenRouter secret in the intended Cloudflare account, verify `/readyz`, inspect the OpenAPI document using each identity, and confirm the provider-side spending limit.

The future Soyuz Service Binding is a transport choice. A trusted server-derived identity resolver can attach Soyuz identity at the HTTP boundary; profile permissions remain checked by the same central policy. Binding setup and consumer migrations are deferred.
