# Development

## Prerequisites

- Node.js 26 and npm.
- Git.
- No OpenRouter or Cloudflare account is needed for the offline test suite.

The Worker uses native Fetch, Request, Response, AbortController, Web Crypto, TextEncoder, and TextDecoder APIs. It does not enable Node.js compatibility in Cloudflare.

## Local setup

From the repository root:

    nvm use
    npm ci
    cp .dev.vars.example .dev.vars

Use placeholders only until you deliberately configure a local provider call. `.dev.vars` is ignored by Git. For local Worker use, it can hold `OPENROUTER_API_KEY` and `SENKU_KASEKI_API_TOKEN`; do not commit it.

Generate a strong Kaseki machine token with at least 256 bits of randomness, for example:

    openssl rand -base64 32

The configured token must be 32–1,024 printable ASCII characters with no whitespace. Do not paste the generated value into source code, documentation, CI variables, or Wrangler text variables.

## Commands

    npm run dev
    npm run typecheck
    npm test
    npm run perf:smoke
    npm run build

`npm run perf:smoke` exercises small, typical, upper-bound generic requests and a representative profile evaluation in the local Workers runtime. It reports local elapsed wall-clock time, not Cloudflare billed CPU. `npm run build` uses Wrangler's dry-run deployment bundle path and does not deploy.

### Optional live provider smoke test

This is a separate, paid inference request. It is excluded from `npm test` and does not run in CI. Run it only when an operator explicitly wants to verify live OpenRouter compatibility:

    OPENROUTER_API_KEY='your-existing-senku-key' npm run smoke:provider

The test sends one small synthetic decision using `~typesafe/jev-latest` and the same provider validation path as the Worker. It prints only status, resolved model, duration, and returned usage. It has no automatic retry. If you already have a local `.dev.vars`, you can load it into the current shell and run the command:

    set -a
    source .dev.vars
    set +a
    npm run smoke:provider

The live test fails clearly when `OPENROUTER_API_KEY` is absent. Never put the key value in a command checked into source control.

## Tests and runtime

The default Vitest configuration uses Cloudflare's `@cloudflare/vitest-plugin` so the Worker and routine tests run in local workerd. Provider tests use an injected fetch function and synthetic responses; routine tests need no provider credentials and make no paid requests.

The separate `vitest.provider-smoke.config.ts` includes only the opt-in live smoke test. Its file is not matched by the normal `npm test` include pattern.

## Environment and secrets

| Variable | Local source | Purpose |
| --- | --- | --- |
| `OPENROUTER_API_KEY` | Secret in `.dev.vars`; Worker secret after deployment | Existing dedicated Senku OpenRouter credential |
| `SENKU_KASEKI_API_TOKEN` | Secret in `.dev.vars`; Worker secret after deployment | Strong bearer token for Kaseki's generic endpoint |
| `JEV_MODEL` | Wrangler variable; optional local value | Must be exactly `~typesafe/jev-latest`; omission selects the same alias |
| `SENKU_PROVIDER_TIMEOUT_MS` | Wrangler variable; optional local override | Provider timeout from 1,000 to 30,000 ms; default is 15,000 |

Every request uses the fixed alias `~typesafe/jev-latest`. The alias may resolve to a different version over time; the provider-resolved model is returned and recorded as safe metadata. A caller cannot provide a model name.

For a deployed Worker, install the existing credentials as secrets:

    npx wrangler secret put OPENROUTER_API_KEY
    npx wrangler secret put SENKU_KASEKI_API_TOKEN

The secret values are entered interactively. The OpenRouter key's presence in an account does not mean it has been installed in local, CI, or deployed configuration. Do not add the actual key to this repository, GitHub Actions, `wrangler.jsonc`, or `wrangler.toml`.

### OpenRouter spending control

Set a credit limit and reset period on the dedicated Senku OpenRouter API key in the OpenRouter key settings or via the Management API. The key limit is the reliable provider-side aggregate cap for inference made with that key. Senku does not claim that a cap has been set.

To verify a configured key limit, inspect the key in OpenRouter or call `GET https://openrouter.ai/api/v1/key` with the dedicated key. Confirm the returned `limit`, `limit_remaining`, and `usage` fields. Do not put a Management API key in Senku; it is not needed for inference.

Reference: [Create an API key with a spending limit](https://openrouter.ai/docs/api/api-reference/api-keys/create-keys), [get current key usage](https://openrouter.ai/docs/api/api-reference/api-keys/get-current-key).

## Deployment setup for a later release

No Cloudflare account, hostname, production secret, or deployment is assumed or configured by this implementation. The planned `workers.dev` hostname may not exist yet. When deployment is separately scheduled:

1. Confirm the Cloudflare account and worker name, and configure a custom hostname only if it exists and is intended for Senku.
2. Authenticate Wrangler in the intended account.
3. Set the two secrets with the Wrangler commands above.
4. Confirm the exact `JEV_MODEL` alias and provider timeout in Wrangler configuration.
5. Run typecheck, offline tests, the dry-run build, and any explicitly requested live smoke test. Use `npm run deploy` only when a production deployment is separately approved.
