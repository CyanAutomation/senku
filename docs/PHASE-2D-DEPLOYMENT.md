# Phase 2D deployment readiness

## Status

**Implementation-ready, not operationally complete.** No production secrets were configured and no deployment or live inference was performed for this change.

The user-provided target hostname is `https://senku.scheimann.workers.dev`; Senku's checked-in Wrangler variable is already set to that origin. A read-only inventory of the connected Cloudflare account on 2026-11-09 listed the existing `soyuz` Worker but no `senku` Worker. The hostname and Worker name therefore remain unverified as live resources.

| Check | Result |
| --- | --- |
| Wrangler Worker name | `senku` in `wrangler.jsonc` |
| Configured UTCP origin | `https://senku.scheimann.workers.dev` |
| Existing `senku` Worker in connected account | Not found during read-only inventory |
| OpenRouter key secret | Not verified; user reports Senku secrets are not deployed |
| Kaseki machine token | Not verified; user reports Senku secrets are not deployed |
| Soyuz machine token | Not verified; user reports Senku secrets are not deployed |
| Provider spending limit | Not verified |
| `/healthz`, `/readyz`, auth, discovery | Not run against production |
| Live inference / HTTPS UTCP | Not run |
| Deployed Worker version / CPU / errors | Not available |
| Senku rollback target | None verified yet |

## Configuration review

The current Worker is configured with:

- Name `senku` and `workers_dev: true`.
- Model alias `~typesafe/jev-latest`.
- Provider timeout default `15,000` ms, with application validation up to `30,000` ms.
- CPU limit `10` ms and `1` outbound provider subrequest.
- Senku is intended to use the Workers Free plan. Cloudflare documents Free limits of 100,000 requests per day, 10 ms CPU per HTTP request, and 50 external plus 1,000 internal-service subrequests per invocation. The configured `limits` overrides are enforced only under the Standard usage model, so the Free plan's defaults apply unless Senku is deployed under Standard.
- No D1, KV, R2, Queue, or Durable Object binding.
- Trusted UTCP origin `https://senku.scheimann.workers.dev`.
- OpenRouter requests use manual redirect handling; redirect responses are rejected as non-success and are not followed by the Worker runtime.

The account inventory shows Soyuz using the Workers `standard` usage model, but Senku does not yet exist there, so its deployed usage model and CPU measurements cannot be verified. Cloudflare documents [Service Bindings](https://developers.cloudflare.com/workers/runtime-apis/bindings/service-bindings/) for same-account Worker-to-Worker calls and lists them under Free-plan internal subrequests in its [limits documentation](https://developers.cloudflare.com/workers/platform/limits/#worker-to-worker-subrequests). The [no-additional-request-fee treatment](https://developers.cloudflare.com/workers/platform/pricing/#service-bindings) applies to Standard pricing; do not assume that billing treatment for a Free Worker. Confirm Senku's actual deployed plan and inspect its request and CPU metrics before deploying the Soyuz binding; no account upgrade or new Cloudflare resource is part of this implementation.

## Required production secrets

Configure these as Worker secrets only after the Worker exists and deployment is authorized:

| Secret | Purpose |
| --- | --- |
| `OPENROUTER_API_KEY` | Dedicated Senku provider credential |
| `SENKU_KASEKI_API_TOKEN` | Kaseki machine identity |
| `SENKU_SOYUZ_API_TOKEN` | Soyuz machine identity, shared with the Soyuz Worker |

Do not put values in Wrangler `vars`, source control, CI logs, or chat. The two Senku machine tokens must be distinct and meet Senku's existing format checks. The Soyuz copy of `SENKU_SOYUZ_API_TOKEN` must match Senku's Soyuz identity secret.

The OpenRouter key should have a provider-side spending cap. Verify that cap and the remaining allowance before making paid inference requests. No management credential or spending limit has been created or checked here.

## Deployment and verification procedure

After the operator authorizes the live change and configures the secrets:

1. Confirm the connected Cloudflare account and target `senku` Worker.
2. Deploy with the existing Wrangler configuration. Record the deployment timestamp and version identifier.
3. Check `GET https://senku.scheimann.workers.dev/healthz` returns a running status and `GET /readyz` returns `ready`, without exposing secrets.
4. Test unauthenticated requests, then test both machine identities. Confirm Kaseki sees only its two profiles and tools, and Soyuz sees only its three profiles and tools. Confirm generic decisions remain forbidden to Soyuz.
5. Perform the bounded synthetic checks in the approved rollout: one permitted Kaseki profile and one permitted Soyuz profile. Record the resolved model, schema, provider attempt count, elapsed time, and returned usage. Do not use sensitive run content.
6. Invoke the authenticated UTCP manual and call an advertised HTTPS profile tool with a synthetic input through the official UTCP client.
7. Inspect Worker CPU, error rate, provider usage, and logs. Confirm no credentials, evidence, or answers were exposed.
8. Record a known-good Worker version for rollback.

Do not run these live checks until the operator has authorized deployment and paid inference. A Wrangler dry-run build or passing local tests do not prove production readiness.

## Rollback

No deployed Senku version or rollback target has been verified. Once Senku has a known-good deployed version, record that version and use Cloudflare's approved version rollback process if a later deployment fails. Do not remove machine credentials during a rollback. Senku is not activated for Soyuz until the service is deployed, ready, authenticated, and verified.

## Limitations

- The Worker and public hostname are not yet live-verified.
- Secrets and OpenRouter spending controls are unverified.
- No live OpenRouter inference or deployed CPU/error measurements are available.
- Soyuz's Phase 3A code uses a direct Service Binding switchover without a runtime feature flag. Do not deploy that Soyuz revision before completing Senku verification and setting the matching Soyuz machine secret.
