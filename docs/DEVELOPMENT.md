# Development

## Prerequisites

- Node.js 26 and npm. Node 26 is the configured local and CI runtime.
- Git.
- No OpenRouter or Cloudflare account is needed for tests.

The Worker uses native Fetch, Request, Response, AbortController, Web Crypto, TextEncoder, and TextDecoder APIs. It does not enable Node.js compatibility in Cloudflare.

## Local setup

From the repository root:

    nvm use
    npm ci
    cp .dev.vars.example .dev.vars

Edit .dev.vars with local values before making a real provider request. The example file contains placeholders only. Do not commit .dev.vars. The routine test suite injects a mocked provider and does not need a paid OpenRouter call.

The local worker can serve /healthz and /readyz without provider calls. POST /v1/decisions returns not configured until both local secrets are set.

## Commands

    npm run dev
    npm run typecheck
    npm test
    npm run perf:smoke
    npm run build

npm run perf:smoke exercises small, typical, and 128 KiB requests inside the local Workers runtime. Its reported durations are elapsed wall-clock time and are not billed CPU measurements. npm run build uses Wrangler's dry-run deployment bundle path and does not deploy.

The test suite uses Cloudflare's current @cloudflare/vitest-plugin integration. Vitest runs the Worker and its tests in the local workerd runtime. Provider behaviour is tested through an injected fetch function, so all routine tests run offline.

## Environment

| Variable | Local source | Purpose |
| --- | --- | --- |
| OPENROUTER_API_KEY | Secret in .dev.vars; Worker secret after deployment | OpenRouter Decisions API credential |
| SENKU_KASEKI_API_TOKEN | Secret in .dev.vars; Worker secret after deployment | Bearer token for the trusted Kaseki client |
| JEV_MODEL | Wrangler variable; optional local override | Server-selected model; default is ~typesafe/jev-latest |
| SENKU_PROVIDER_TIMEOUT_MS | Wrangler variable; optional local override | Provider timeout from 1,000 to 30,000 ms; default is 15,000 |

Do not set live credentials in checked-in files, CI variables, or Wrangler text variables. Only the model name and timeout are non-secret settings.

## Deployment setup for a later release

No Cloudflare account, hostname, or production secret is assumed or configured by this phase. The planned workers.dev hostname may not exist yet. When deployment is explicitly scheduled:

1. Confirm the Cloudflare account and worker name, and configure a custom hostname only if it exists and is intended for Senku.
2. Authenticate Wrangler in the intended account.
3. Set both credentials with Wrangler's secret command:

       npx wrangler secret put OPENROUTER_API_KEY
       npx wrangler secret put SENKU_KASEKI_API_TOKEN

4. Confirm non-secret JEV_MODEL and SENKU_PROVIDER_TIMEOUT_MS values in the Wrangler configuration.
5. Run the local typecheck, tests, and dry-run build again, then use npm run deploy only when a production deployment is explicitly approved.

The deploy script is provided for future use but was not run during Phase 1.
