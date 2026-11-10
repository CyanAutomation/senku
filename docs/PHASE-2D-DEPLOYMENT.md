# Phase 2D deployment status

## Status

**Deployed, configured, and inference-exercised; production sign-off is still pending.** Senku is publicly deployed. Cloudflare's current Worker settings show all three required secrets as bound, and the Worker reports `usage_model: standard`. Four inference runs have been reported in Cloudflare logs. Their run-level details and current health/readiness responses still need to be captured for this status record.

| Check | Result |
| --- | --- |
| Worker name and hostname | `senku`; `https://senku.scheimann.workers.dev` |
| Active deployment | Version 7 (`a95c3e84-ad2f-423a-943f-ef5c0604b5b2`), deployment `a4e8e4fe-10b5-4230-9996-94375a7ad978`, serving 100% of traffic as of 2026-11-09 23:33 UTC |
| `GET /healthz` and `GET /readyz` | Earlier checks returned `ok` and `not_ready` respectively, while secrets were absent. A fresh check was blocked before reaching the Worker by this environment's outbound proxy (HTTP 403). |
| Required secret bindings | `OPENROUTER_API_KEY`, `SENKU_KASEKI_API_TOKEN`, and `SENKU_SOYUZ_API_TOKEN` are present as secret bindings. Values were not read. |
| Worker usage model | `standard` in the current Cloudflare Worker settings |
| Provider spending limit | Not verified; the read-only OpenRouter key-info request returned HTTP 401 using the available runtime credential |
| Authenticated discovery and profile permissions | Local auth/profile tests pass; production behavior was not reverified in this review |
| UTCP | Sampled Workers Logs include one `GET /utcp` response with HTTP 200; local UTCP tests pass, but this does not verify authenticated production discovery or invocation |
| Live inference | Four runs reported in Cloudflare logs; record the run metadata from the dashboard as described below. The sampled API query used for this review did not return the inference completion records. |
| CPU and HTTP status metrics | Sampled aggregate: 10 HTTP 200 and 40 HTTP 404 events at sample interval 10; average CPU was 12 ms for 200s and 1.5 ms for 404s. No 5xx appeared in the sample. These are not full usage totals. |
| Provider usage | Not available from the sampled Worker logs; the OpenRouter key-info request did not return usage data |
| Soyuz Service Binding | Version 34 (`0970d962-124c-4a51-8f27-5f05bc3f7d1a`), deployment `a4057c47-93b9-4818-9c51-e82e82e69a82`, serves 100% of Soyuz traffic as of 2026-11-10 13:48 UTC and has a `SENKU` binding to service `senku` in `production`. Senku and Soyuz both report `usage_model: standard`. Whether Soyuz has exercised the binding was not verified. |
| Local verification | 83 application tests, 1 OpenAPI test, and 2 Wrangler config checks passed on Node 26.13.0. These do not verify production credentials or live route behavior. |
| Previous deployments | Version 6 exists, so this is no longer the first deployment. Its suitability as a rollback target has not been confirmed. |

## Configuration and plan notes

The deployed Worker uses these checked-in public variables:

- Model alias `~typesafe/jev-latest`.
- Provider timeout `15,000` ms.
- Public base URL `https://senku.scheimann.workers.dev`.

It has no D1, KV, R2, Queue, or Durable Object binding. Workers Logs and Traces are enabled with query-string redaction, 10% log sampling, and 1% trace sampling. Invocation logs are enabled in the deployed settings and are now explicitly enabled in `wrangler.jsonc`. A Workers Observability query on 2026-11-10 returned nine sampled invocation records: eight `GET /` 404 responses and one `GET /utcp` 200 response. A sampled aggregate query for 2026-11-09 through 2026-11-10 returned weighted estimates of 10 HTTP 200 and 40 HTTP 404 events (sample interval 10), with average CPU of 12 ms and 1.5 ms respectively. No 5xx appeared in the returned sample. These observations are not a complete history or full billable usage report.

The first upload attempt on 2026-11-09 included `limits.cpu_ms: 10` and `limits.subrequests: 1`; Cloudflare rejected it, and the deployment record attributed the rejection to the account's Workers Free plan. The `limits` override was removed from `wrangler.jsonc`, so Cloudflare's account defaults apply and the one-subrequest cap is not active.

The current Worker APIs report `usage_model: standard` for both Senku and Soyuz. Treat this as each Worker's billing model; it does not establish the account's current Workers subscription by itself. Cloudflare's pricing page says Workers Paid includes the Standard usage model. The account-subscription lookup was unavailable to the connected Cloudflare OAuth session because it lacks Billing Read, and the Cloudflare dashboard could not be opened from this environment. The account's current Free/Paid plan therefore remains unverified. Confirm it in Cloudflare billing before relying on Free-plan limits or Paid-plan pricing.

Service Binding charges depend on the usage model. Under Workers Standard, a Worker-to-Worker Service Binding call does not add a separate request fee; the initial request is counted once and CPU time across both Workers is included. On the legacy Bundled or Unbound models, a Worker invoked through a Service Binding is charged as another request. Soyuz's production Worker already has a `SENKU` Service Binding configured to `senku`; do not describe the integration as inactive. Both Workers report Standard, but confirm the account plan and whether the live Soyuz route uses the binding before making a production change. See [Cloudflare Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/#service-bindings).

## Required production secrets

Cloudflare currently reports all three required secret bindings for Senku:

| Secret | Purpose |
| --- | --- |
| `OPENROUTER_API_KEY` | Dedicated Senku provider credential |
| `SENKU_KASEKI_API_TOKEN` | Kaseki machine identity |
| `SENKU_SOYUZ_API_TOKEN` | Soyuz machine identity, shared with the Soyuz Worker |

Do not put secret values in Wrangler `vars`, source control, CI logs, or chat. The two Senku machine tokens must remain distinct and meet Senku's format checks. The Soyuz copy of `SENKU_SOYUZ_API_TOKEN` must match Senku's Soyuz identity secret; equality was not checked because secret values were not read.

The OpenRouter key should have a provider-side spending cap. A read-only request to OpenRouter's key-info endpoint using the runtime credential available in this environment returned HTTP 401, so no cap or usage data was returned. The Cloudflare Worker secret value was not read and may differ from this environment credential. Resolve the key-info access and verify the cap and remaining allowance before authorizing additional paid inference.

## Next verification steps

1. Review the four inference entries in Cloudflare Workers Logs. Record timestamp, resolved model, completion status, provider attempt count, duration, and returned usage. Do not copy prompts, evidence, answers, credentials, or other run content into this document. The sampled API query available to this review did not surface those completion entries.
2. Recheck `GET /healthz` and `GET /readyz` from a network path that can reach `workers.dev`. Record response codes and bodies without exposing secrets; this environment's proxy blocked the direct request before it reached the Worker.
3. Confirm the account's Workers plan in Cloudflare billing. Resolve the OpenRouter key-info 401 and check the spend cap and usage after the four runs. Do not make additional paid inference requests until the allowance is confirmed.
4. Verify unauthenticated requests fail, Kaseki sees only its two profiles and tools, Soyuz sees only its three profiles and tools, and generic decisions remain forbidden to Soyuz. Local tests cover these rules, but production behavior still needs live verification.
5. Audit the existing production Soyuz `SENKU` binding: confirm it is intentional, whether the current code path invokes it, and that the shared machine identity is correctly configured without exposing its value. Both Workers report Standard usage, but the account plan is still unconfirmed.
6. Verify UTCP HTTPS interoperability and the allowed profile invocation path. Use only synthetic, non-sensitive inputs for any additional provider call, bounded by a confirmed spend allowance.
7. Review CPU time, error rates, provider usage, and available logs. Confirm no credentials or run content are exposed. Treat sampled logs as incomplete evidence.

## Rollback

The active deployment is version 7 (`a95c3e84-ad2f-423a-943f-ef5c0604b5b2`), deployment `a4e8e4fe-10b5-4230-9996-94375a7ad978`. Version 6 (`0f794bca-c27a-4c60-a96b-54bb4abb8666`), deployment `7474c3ef-9f30-44e5-8ae6-c1d99201fcbd`, is its immediate predecessor. Confirm that a previous version has the required bindings and is a suitable last-known-good before rolling back. To take the public endpoint offline, disable the Worker `workers.dev` subdomain in Cloudflare. Do not remove machine credentials during a code rollback.

## Remaining limitations

- Current health and readiness responses were not rechecked because the environment's outbound proxy rejected the public endpoint request before it reached the Worker.
- Four inference runs are reported in Cloudflare logs, but their run-level metadata has not yet been transcribed here; the API query available in this review returned sampled invocation records only.
- The account's current Workers Free/Paid plan and the OpenRouter spending limit remain unverified. The available OpenRouter key-info request returned HTTP 401.
- Authenticated discovery, production profile authorization, and UTCP HTTPS interoperability still need live review. Local application tests pass.
- CPU/status aggregates are sample-based and do not establish full request totals, error rates, or provider spend.
- Workers Logs sample 10% of events and Traces sample 1%; missing entries in a query do not prove that an event did not occur.
- The current Soyuz production Worker already has a Service Binding to Senku. Confirm whether its use is intentional and assess the live route before disabling or changing it.
