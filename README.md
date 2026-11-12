# Senku

Senku is a stateless Cloudflare Worker that provides bounded, typed JEV decisions to [Kaseki-Agent](https://github.com/CyanAutomation/kaseki-agent) and [Soyuz](https://github.com/CyanAutomation/soyuz). Callers send evidence; Senku owns the questions and profile contracts. Results are advisory, and each consumer keeps its deterministic policy and execution controls.

**Phases 1 through 2C are implemented on main.** Senku exposes authenticated profile evaluation, permission-filtered REST and UTCP discovery, and identity-filtered OpenAPI 3.1. Phase 2D has a first health-checked Cloudflare deployment, but Senku remains not ready until its three production secrets are configured. The GitHub Actions deployment workflow deploys after a pull request merges to `main`; see [the deployment status](docs/PHASE-2D-DEPLOYMENT.md) and [development guide](docs/DEVELOPMENT.md) for setup and verification. Soyuz Phase 3A integration remains in progress.

## API

| Method | Path | Access |
| --- | --- | --- |
| `POST` | `/v1/profiles/{profileId}/evaluate` | Authenticated; profile permission checked |
| `GET` | `/v1/profiles` | Authenticated; returns only permitted profiles |
| `GET` | `/v1/profiles/{profileId}` | Authenticated; public contract for a permitted profile |
| `GET` | `/openapi.json` | Authenticated; OpenAPI filtered by caller permissions |
| `GET` | `/utcp` | Authenticated; UTCP manual filtered by caller permissions |
| `GET` | `/healthz` | Public liveness check |
| `GET` | `/readyz` | Public configuration readiness check |

The eight registered profiles include five Kaseki profiles: `task_admission_v1`, `kaseki_goal_check_v1`, `kaseki_run_evaluation_v1`, `kaseki_context_routing_v1`, and `validation_recovery_v1`. Soyuz has `run_operations_triage_v1`, `kaseki_output_review_v1`, and `kaseki_output_review_v2`. See [docs/PROFILES.md](docs/PROFILES.md) for inputs, limits, and outputs.

Profile evaluation uses a versioned evidence envelope:

```json
{
  "schemaVersion": "1",
  "input": {
    "run": {
      "status": "failed",
      "stage": "validation",
      "operationalHealth": "suspect_stalled",
      "failureClass": "provider_failure",
      "createdAt": "2026-11-08T12:00:00.000Z",
      "queuedAt": "2026-11-08T12:00:01.000Z",
      "startedAt": "2026-11-08T12:00:02.000Z",
      "completedAt": "2026-11-08T12:00:03.000Z",
      "lastHeartbeatAt": "2026-11-08T12:00:02.500Z"
    }
  }
}
```

```sh
curl https://senku.example.workers.dev/v1/profiles/run_operations_triage_v1/evaluate \
  -H 'Authorization: Bearer <SENKU_SOYUZ_API_TOKEN>' \
  -H 'Content-Type: application/json' \
  --data-binary @triage-request.json
```

## Authentication and permissions

Configure two separate strong machine tokens: `SENKU_KASEKI_API_TOKEN` and `SENKU_SOYUZ_API_TOKEN`. Each must contain 32–1,024 printable ASCII characters, and the values must differ. Missing, malformed, or duplicate token configuration fails closed and keeps `/readyz` at `not_ready`. Identity comes from the matched bearer credential. Body fields and identity headers do not select a client.

Kaseki may call its five profiles. Soyuz may call its three profiles. Both identities are restricted to server-owned profiles; arbitrary caller-defined questions are not accepted. Authenticated responses use `Cache-Control: no-store`. Senku does not enable CORS.

`GET /utcp` uses the same bearer identity and central permission matrix. Kaseki discovers five profile tools; Soyuz discovers three. Every tool calls its existing profile REST route. The manual never exposes credentials or caller-defined question endpoints. See [docs/UTCP.md](docs/UTCP.md) for client setup and body mapping.

The current Worker uses bearer tokens. Soyuz's Service Binding client sends its dedicated bearer identity through the same authenticated profile routes; Senku's central permission policy remains unchanged.

## Runtime and safety

- Native TypeScript and Web APIs; no persistent storage and no runtime framework.
- UTCP SDK and HTTP client packages are development-only interoperability dependencies; they are not bundled into the Worker.
- Fixed provider endpoint and the single model alias `~typesafe/jev-latest`.
- One provider attempt per evaluation; no retries or fallback models.
- Bounded requests and profile evidence; streamed provider response limit of 64 KiB.
- Safe operational logs contain IDs, sizes, timings, question counts, model, and usage, never caller evidence or credentials.
- Validation recovery redacts common credential patterns before retaining the output tail, then enforces the final evidence byte limit. Redaction is a bounded precaution, not a guarantee that every possible secret is removed.
- JEV confidence may be `null`. Future Kaseki adapters must treat null as unavailable/zero confidence for any confidence gate; they must not invent a high-confidence value.
- Kaseki can store `-1` when a process exit is unavailable. Soyuz signal-derived values such as `143` are preserved. Output-review profiles accept `-1..255` and reject values outside that range.
- The dedicated OpenRouter key should have a provider-side spending limit. Senku does not claim that a limit is configured.

The service makes one outbound provider subrequest per evaluation, has no database, and ships a small bundle. Cloudflare's account defaults apply because custom CPU and subrequest limits were rejected on the current Free plan. Local timings are not production CPU measurements. Phase 2D operational readiness and live verification remain incomplete; see [docs/PHASE-2D-DEPLOYMENT.md](docs/PHASE-2D-DEPLOYMENT.md).

## Local development

Requirements: Node.js 26 and npm.

```sh
nvm use
npm ci
cp .dev.vars.example .dev.vars
npm run typecheck
npm test
npm run perf:smoke
npm run build
```

For local UTCP discovery, `.dev.vars.example` sets `SENKU_PUBLIC_BASE_URL=http://127.0.0.1:8787`. Start the Worker with `npm run dev -- --ip 127.0.0.1 --port 8787`.

Routine tests mock the provider and do not incur provider charges. `npm run build` uses Wrangler's dry-run build and does not deploy. The live-provider smoke test is separate and opt-in; see [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md).

## Documentation

- [REST and error contract](docs/CONTRACT.md)
- [Profile contracts](docs/PROFILES.md)
- [Development and operations](docs/DEVELOPMENT.md)
- [UTCP discovery and client usage](docs/UTCP.md)
- [Phase 2D deployment readiness and status](docs/PHASE-2D-DEPLOYMENT.md)
- [Phase 2C decisions and measurements](docs/PHASE-2C-DECISIONS.md)
- [Phase 2B decisions](docs/PHASE-2B-DECISIONS.md)
- [Phase 2A decisions](docs/PHASE-2A-DECISIONS.md)

## Roadmap

- [x] Phase 1.1 — Provider and generic API hardening
- [x] Phase 2A — Internal profile registry, engine, and permissions
- [x] Phase 2B — Authenticated profile REST API, discovery, OpenAPI, and contract hardening
- [x] Phase 2C — Permission-aware UTCP discovery, native HTTP invocation, and client interoperability
- [ ] Phase 2D — Independent deployment and live verification
- [ ] Phase 3A — Soyuz Service Binding production activation
- [ ] Phase 4 — Kaseki remote `DecisionService` adapter and staged migration
- [ ] Follow-on — Calibration against replayable evaluations and outcomes

Senku UTCP describes bounded decision evaluations. Soyuz UTCP describes Soyuz-owned run-management operations in that separate repository. Neither service needs an MCP-compatible proxy for native UTCP invocation. Persistent histories and Kaseki's remote `DecisionService` adapter remain separate follow-on work.
