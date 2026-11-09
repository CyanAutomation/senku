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
npm run validate:openapi
npm run perf:smoke
npm run build
```

The routine test suite uses mocked provider responses and does not incur provider charges. `npm run validate:openapi` independently checks both permission-filtered OpenAPI 3.1 documents with Redocly; `npm test` runs it automatically after the Worker tests. `npm run perf:smoke` exercises discovery, OpenAPI serialization, profile contracts, all five profile HTTP paths, and the official UTCP client with mocked provider responses. It reports generated sizes, request/evidence sizes, provider attempts, and local elapsed wall time. It is not a measurement of billed Cloudflare CPU. `npm run build` performs Wrangler's dry-run build, does not deploy, and emits the bundle whose size is recorded in [PHASE-2C-DECISIONS.md](PHASE-2C-DECISIONS.md).

The generated OpenAPI document is available at `/openapi.json` when a Worker is running. That route requires one of the configured machine credentials and shows only the authenticated identity's profiles.

The UTCP manual is available at `/utcp` and uses the same identity filter. Configure `SENKU_PUBLIC_BASE_URL` to the trusted public origin advertised by the manual. The local example uses `http://127.0.0.1:8787`; production requires HTTPS. The Worker does not infer this value from request Host headers. See [UTCP.md](UTCP.md) for the official client example and complete envelope mapping.

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
| `SENKU_PUBLIC_BASE_URL` | Wrangler variable; local `.dev.vars` override | Trusted origin used for absolute UTCP tool URLs; HTTPS except loopback HTTP |
| `JEV_MODEL` | Wrangler variable; optional local value | Must be exactly `~typesafe/jev-latest`; omission selects that alias |
| `SENKU_PROVIDER_TIMEOUT_MS` | Wrangler variable; optional local override | 1,000–30,000 ms; default is 15,000 ms |

Both machine tokens are required, must satisfy the strong-token format, and must differ. Any missing, invalid, or duplicate token configuration fails closed and makes `/readyz` return `not_ready`. A credential never identifies a caller through the request body, query string, or identity header. No CORS headers are enabled.

Install the three production secrets on the Cloudflare Worker, not in the GitHub Actions environment:

```sh
npx wrangler secret put OPENROUTER_API_KEY
npx wrangler secret put SENKU_KASEKI_API_TOKEN
npx wrangler secret put SENKU_SOYUZ_API_TOKEN
```

These commands prompt for each value and deploy a new Worker version. Keep the three secret values out of GitHub Actions logs, Wrangler `vars`, and source control. Routine validation uses `npm run build` and does not deploy.

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

curl http://127.0.0.1:8787/utcp \
  -H 'Authorization: Bearer <SENKU_KASEKI_API_TOKEN>'
```

The Soyuz credential cannot call the generic `/v1/decisions` route or inspect Kaseki profile contracts. Kaseki cannot inspect or invoke Soyuz profiles.

## Spending control

The dedicated Senku OpenRouter API key should have a provider-side spending limit. This report does not claim that a limit is configured. Check the key in OpenRouter before any opt-in live smoke test; do not use a Management API key in Senku.

## Cloudflare Free-plan constraints

Senku remains stateless with no D1, KV, R2, Queue, or Durable Object. It uses one outbound provider subrequest per evaluation, fixed URL/model, bounded payloads, and no automatic retries. Cloudflare's account defaults apply because custom CPU and subrequest limits were rejected on the current Free plan. Local performance results are useful for relative comparisons but do not establish production CPU usage; measure deployed CPU after deployment.

## CI and deployment

The `CI` workflow runs typecheck, tests with mocked provider responses, OpenAPI validation, and Wrangler's dry-run build for pull requests. It does not make live provider calls. The `CodeQL` workflow analyzes JavaScript/TypeScript on pull requests, pushes to `main`, and weekly. Require both `verify` and `CodeQL / Analyze (javascript-typescript)` before merging into `main`. Workflow actions are pinned to commit SHAs; Dependabot checks for updates weekly.

The `Deploy Worker` workflow runs after a pull request is merged into `main` and runs `npm ci` followed by `npm run deploy`, using the repository's `cloudflare` GitHub Actions environment. It checks out `main` and relies on the required pre-merge CI check instead of rerunning the test suite. The environment has no branch or tag restriction; the workflow trigger and merge condition limit deployments to merged pull requests targeting `main`. The environment has these entries:

| GitHub Environment entry | Value |
| --- | --- |
| Variable `CLOUDFLARE_ACCOUNT_ID` | Cloudflare account ID that owns the `senku` Worker |
| Secret `CLOUDFLARE_API_TOKEN` | Account-scoped Cloudflare API token with Workers Editor permission |

These credentials authorize Wrangler to deploy. They do not configure the Worker’s runtime secrets. Set `OPENROUTER_API_KEY`, `SENKU_KASEKI_API_TOKEN`, and `SENKU_SOYUZ_API_TOKEN` directly on the Cloudflare Worker as described above. Until all three are configured, `/readyz` remains `not_ready` even though a deployment can succeed. Keep the provider spending limit and post-deployment verification steps in [PHASE-2D-DEPLOYMENT.md](PHASE-2D-DEPLOYMENT.md) as production gates.

Soyuz's Service Binding is a transport choice. Soyuz sends its dedicated bearer identity to the same authenticated REST profile route; Senku's existing identity and profile permission checks remain active.
