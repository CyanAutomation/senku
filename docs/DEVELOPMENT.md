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
npm run validate:skills
npm test
npm run test:soyuz-simulator
npm run validate:openapi
npm run perf:smoke
npm run build
```

The routine test suite uses mocked provider responses and does not incur provider charges. The performance benchmarks are excluded from `npm test` and run through `npm run perf:smoke`. `npm run validate:openapi` independently checks both permission-filtered OpenAPI 3.1 documents with Redocly; `npm test` runs it automatically after the Worker tests. `npm run perf:smoke` benchmarks discovery, OpenAPI serialization, all nine profile contracts, five representative maximum-input evaluation paths, and one official UTCP invocation per identity with mocked provider responses. It reports generated sizes, request/evidence sizes, provider attempts, and local elapsed wall time. Timings are informational only: there are no latency thresholds, and local workerd time is not a measurement of billed Cloudflare CPU. The benchmark command selects only the two UTCP invocation cases; the remaining UTCP contract tests run once in `npm test`. The scheduled or manually started `Performance smoke` workflow saves its log as a 14-day artifact. `npm run build` performs Wrangler's dry-run build, does not deploy, and emits the bundle whose size is recorded in [PHASE-2C-DECISIONS.md](PHASE-2C-DECISIONS.md).

`npm run test:soyuz-simulator` runs the Senku-side Service Binding integration harness. It uses the real Senku Worker, a test-only Soyuz dashboard/client simulator, sanitized retained-run fixtures, and a mocked provider. It does not require a Cloudflare account or real credentials. See [SOYUZ-INTEGRATION-TESTING.md](SOYUZ-INTEGRATION-TESTING.md) for the simulator boundary and the command for Soyuz's full cross-worker test.

`npm run validate:skills` checks `.github/skills` frontmatter, skill-directory names, index coverage, and local Markdown links. CI runs this check as part of `verify`.

The HTML API guide is available at `/docs/` when a Worker is running. Enter a configured machine token to browse and download the matching permission-filtered OpenAPI document. The page uses only same-origin requests and does not save the token. `/docs` redirects to `/docs/`.

The generated OpenAPI document is also available directly at `/openapi.json`; that route requires a machine credential and shows only the authenticated identity's profiles. See [Example requests](#example-requests) below for script usage.

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

Each credential can inspect and invoke only its registered profiles. Neither identity can call a generic caller-defined decision route.

## Spending control

The dedicated Senku OpenRouter API key should have a provider-side spending limit. This report does not claim that a limit is configured. Check the key in OpenRouter before any opt-in live smoke test; do not use a Management API key in Senku.

## Cloudflare Free-plan constraints

Senku remains stateless with no D1, KV, R2, Queue, or Durable Object. It uses one outbound provider subrequest per evaluation, fixed URL/model, bounded payloads, and no automatic retries. Cloudflare's account defaults apply because custom CPU and subrequest limits were rejected on the current Free plan. Local performance results are useful for relative comparisons but do not establish production CPU usage; measure deployed CPU after deployment.

## CI and deployment

The `CI` workflow runs a high/critical dependency audit, typecheck, tests with mocked provider responses, OpenAPI validation, and Wrangler's dry-run build for pull requests and pushes to `main`. It does not make live provider calls. The audit temporarily permits the currently unfixed `GHSA-MRHX-C7XC-M3W5` advisory in Zod through `@utcp/sdk`; the exception expires on 2027-02-22 and CI fails if a compatible fix becomes available or the exception expires. Pull requests also run dependency review, which blocks newly introduced high or critical vulnerabilities in runtime and development dependencies. The `workflow-security` job runs actionlint and `zizmor`; actionlint is pinned as a Go module in `.github/actionlint` so Dependabot can update it, and zizmor adds workflow security annotations. The `CodeQL` workflow analyzes JavaScript/TypeScript on pull requests, pushes to `main`, and weekly. The `Scorecard` workflow publishes an OSSF supply-chain report on main pushes, weekly, and branch protection changes. Require the `verify`, `dependency-review`, `workflow-security`, and `Analyze (javascript-typescript)` status contexts before merging into `main`; keep required checks current with the target branch and require a human approval under the repository's review policy. Workflow actions are pinned to commit SHAs; Dependabot checks npm, GitHub Actions, and the actionlint Go module weekly.

After a push to `main`, the `Deploy Worker` job runs only if both `verify` and `workflow-security` succeed. It deploys the exact commit that passed validation, then retries public `/healthz` and `/readyz` checks. `/readyz` must return `{"status":"ready"}`; a deployment with missing or invalid runtime configuration fails the job. The job uses the repository's `cloudflare` GitHub Actions environment and has these entries:

| GitHub Environment entry | Value |
| --- | --- |
| Variable `CLOUDFLARE_ACCOUNT_ID` | Cloudflare account ID that owns the `senku` Worker |
| Secret `CLOUDFLARE_API_TOKEN` | Account-scoped Cloudflare API token with Workers Editor permission |

In GitHub's environment settings, restrict `cloudflare` deployments to the `main` branch and configure deployment reviewers according to the production approval policy. The workflow itself only starts deployment for a successful push to `main`.

The repository's active `Basic protection` ruleset is external to these files. Keep it aligned with the required checks above, require up-to-date branches, and require at least one approval if the maintainer review policy expects human review. Verify the environment's branch restriction and reviewers directly in GitHub.

These credentials authorize Wrangler to deploy. They do not configure the Worker’s runtime secrets. Set `OPENROUTER_API_KEY`, `SENKU_KASEKI_API_TOKEN`, and `SENKU_SOYUZ_API_TOKEN` directly on the Cloudflare Worker before deploying; the readiness check blocks a release until all three are valid. Keep the provider spending limit and post-deployment verification steps in [PHASE-2D-DEPLOYMENT.md](PHASE-2D-DEPLOYMENT.md) as production gates.

Soyuz's Service Binding is a transport choice. Soyuz sends its dedicated bearer identity to the same authenticated REST profile route; Senku's existing identity and profile permission checks remain active.
