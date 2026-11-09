# Phase 2D deployment status

## Status

**Deployed and health-checked; not operationally complete.** The Worker is publicly reachable, but Senku is not ready because its three secrets are not configured. No authenticated discovery, UTCP invocation, or provider inference has been run.

Cloudflare created the `senku` Worker on 2026-11-09. The active Worker version tag is `12f21102fd644d06ab1f55b3e64290e5` and the deployment ID is `4753a344c8244752a6483d8b9c5e4126`. The `senku.scheimann.workers.dev` subdomain is enabled; preview URLs are disabled.

| Check | Result |
| --- | --- |
| Worker name and hostname | `senku`; `https://senku.scheimann.workers.dev` |
| Deployment version | Tag `12f21102fd644d06ab1f55b3e64290e5`; deployment `4753a344c8244752a6483d8b9c5e4126` |
| `GET /healthz` | `{"status":"ok"}` |
| `GET /readyz` | `{"status":"not_ready"}`; expected while required secrets are absent |
| Senku secret bindings | None configured |
| Provider spending limit | Not verified |
| Auth, profile discovery, and UTCP | Not run |
| Live inference | Not run; no provider call was made |
| CPU and error metrics | Not collected |
| Pre-deployment rollback target | None; this was the first Senku deployment |

## Configuration and plan notes

The deployed Worker uses the checked-in public variables:

- Model alias `~typesafe/jev-latest`.
- Provider timeout `15,000` ms.
- Public base URL `https://senku.scheimann.workers.dev`.

It has no D1, KV, R2, Queue, or Durable Object binding. Workers Logs and Traces are enabled with query-string redaction, 10% log sampling, and 1% trace sampling.

The first upload attempt included `limits.cpu_ms: 10` and `limits.subrequests: 1`; Cloudflare rejected it because custom CPU limits are unsupported on the account's current Workers Free plan. Per the operator's direction, the `limits` override was removed from `wrangler.jsonc`, and the successful deployment used Cloudflare's account defaults. This means the configured one-subrequest cap is not active. Cloudflare documents Free-plan defaults of 10 ms CPU per HTTP request and 50 external subrequests per invocation in its [Workers limits documentation](https://developers.cloudflare.com/workers/platform/limits/#account-plan-limits).

Cloudflare's Worker API reports `usage_model: standard`, matching the account's configured default. No account plan or billing setting was changed. The upload rejection confirmed that the current account does not accept custom CPU limits. Verify billing and runtime metrics in the Cloudflare dashboard before relying on pricing assumptions or activating Soyuz's Service Binding.

## Required production secrets

Configure these as Worker secrets after deployment:

| Secret | Purpose |
| --- | --- |
| `OPENROUTER_API_KEY` | Dedicated Senku provider credential |
| `SENKU_KASEKI_API_TOKEN` | Kaseki machine identity |
| `SENKU_SOYUZ_API_TOKEN` | Soyuz machine identity, shared with the Soyuz Worker |

Cloudflare currently reports no secret bindings for Senku. Do not put values in Wrangler `vars`, source control, CI logs, or chat. The two Senku machine tokens must be distinct and meet Senku's existing format checks. The Soyuz copy of `SENKU_SOYUZ_API_TOKEN` must match Senku's Soyuz identity secret.

The OpenRouter key should have a provider-side spending cap. Verify that cap and remaining allowance before making paid inference requests. No management credential or spending limit has been created or checked here.

## Next verification steps

After the operator configures the secrets and verifies the provider spending cap:

1. Confirm `GET /readyz` returns ready without exposing secret values.
2. Test unauthenticated requests, then test both machine identities. Confirm Kaseki sees only its two profiles and tools, and Soyuz sees only its three profiles and tools. Confirm generic decisions remain forbidden to Soyuz.
3. Perform only the authorized bounded synthetic inference and UTCP profile invocation. Record the resolved model, schema, provider attempt count, elapsed time, and returned usage. Do not use sensitive run content.
4. Inspect Worker CPU, errors, provider usage, and logs. Confirm no credentials, evidence, or answers were exposed.
5. Keep Soyuz production integration inactive until Senku passes those checks and the spend cap is confirmed.

## Rollback

This was the first Senku deployment, so no earlier version exists to restore. The current version tag `12f21102fd644d06ab1f55b3e64290e5` is the baseline for a future version rollback. To take the public endpoint offline, disable the Worker `workers.dev` subdomain in Cloudflare. Do not remove machine credentials during a code rollback.

## Remaining limitations

- Readiness is false until all three secrets are configured.
- Provider spending controls are unverified.
- Authenticated discovery, UTCP HTTPS interoperability, and bounded inference remain untested.
- Production CPU, error, and provider usage metrics have not been collected.
- Soyuz's Phase 3A code uses a direct Service Binding switchover without a runtime feature flag. Do not activate or deploy that Soyuz revision before completing Senku verification and configuring the matching Soyuz machine secret.
