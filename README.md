# Senku

Senku is a stateless Cloudflare Worker that provides bounded, typed JEV decisions to [Kaseki-Agent](https://github.com/CyanAutomation/kaseki-agent) and [Soyuz](https://github.com/CyanAutomation/soyuz). Callers send evidence; Senku owns the questions and profile contracts. Results are advisory, and each consumer keeps its deterministic policy and execution controls.

**Phase 2B is implemented in this branch.** Senku exposes authenticated profile evaluation, permission-filtered discovery, and a generated OpenAPI 3.1 document alongside the existing generic decision, health, and readiness endpoints. It has not been deployed. UTCP, the Soyuz Service Binding, and consumer migrations remain future work.

## API

| Method | Path | Access |
| --- | --- | --- |
| `POST` | `/v1/decisions` | Kaseki only; bounded dynamic questions |
| `POST` | `/v1/profiles/{profileId}/evaluate` | Authenticated; profile permission checked |
| `GET` | `/v1/profiles` | Authenticated; returns only permitted profiles |
| `GET` | `/v1/profiles/{profileId}` | Authenticated; public contract for a permitted profile |
| `GET` | `/openapi.json` | Authenticated; OpenAPI filtered by caller permissions |
| `GET` | `/healthz` | Public liveness check |
| `GET` | `/readyz` | Public configuration readiness check |

The five registered profiles are `task_admission_v1` and `validation_recovery_v1` for Kaseki, and `run_operations_triage_v1`, `kaseki_output_review_v1`, and `kaseki_output_review_v2` for Soyuz. See [docs/PROFILES.md](docs/PROFILES.md) for inputs, limits, and outputs.

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

Kaseki may call the generic endpoint and its two profiles. Soyuz may call its three profiles and cannot call generic decisions. Authenticated responses use `Cache-Control: no-store`. Senku does not enable CORS.

The current Worker uses bearer tokens. A future Service Binding can supply identity through a trusted server-side resolver at the HTTP boundary; it will still pass through the central profile permission policy. No Service Binding is configured in this phase.

## Runtime and safety

- Native TypeScript and Web APIs; no persistent storage and no runtime framework.
- Fixed provider endpoint and the single model alias `~typesafe/jev-latest`.
- One provider attempt per evaluation; no retries or fallback models.
- Bounded requests and profile evidence; streamed provider response limit of 64 KiB.
- Safe operational logs contain IDs, sizes, timings, question counts, model, and usage, never caller evidence or credentials.
- Validation recovery redacts common credential patterns before retaining the output tail, then enforces the final evidence byte limit. Redaction is a bounded precaution, not a guarantee that every possible secret is removed.
- JEV confidence may be `null`. Future Kaseki adapters must treat null as unavailable/zero confidence for any confidence gate; they must not invent a high-confidence value.
- Kaseki can store `-1` when a process exit is unavailable. Soyuz signal-derived values such as `143` are preserved. Output-review profiles accept `-1..255` and reject values outside that range.
- The dedicated OpenRouter key should have a provider-side spending limit. Senku does not claim that a limit is configured.

The service targets Cloudflare Workers Free: 10 ms CPU, one outbound subrequest per evaluation, no database, and small bundles. Local timings are not production CPU measurements. No production deployment happens as part of Phase 2B.

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

Routine tests mock the provider and do not incur provider charges. `npm run build` uses Wrangler's dry-run build and does not deploy. The live-provider smoke test is separate and opt-in; see [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md).

## Documentation

- [REST and error contract](docs/CONTRACT.md)
- [Profile contracts](docs/PROFILES.md)
- [Development and operations](docs/DEVELOPMENT.md)
- [Phase 2B decisions](docs/PHASE-2B-DECISIONS.md)
- [Phase 2A decisions](docs/PHASE-2A-DECISIONS.md)

## Roadmap

- [x] Phase 1.1 — Provider and generic API hardening
- [x] Phase 2A — Internal profile registry, engine, and permissions
- [x] Phase 2B — Authenticated profile REST API, discovery, OpenAPI, and contract hardening
- [ ] Phase 2C — UTCP discovery, after validating the selected specification and client behavior
- [ ] Phase 3 — Soyuz Service Binding and consumer integration
- [ ] Phase 4 — Kaseki remote `DecisionService` adapter and staged migration
- [ ] Follow-on — Calibration against replayable evaluations and outcomes

Neither MCP nor UTCP endpoints, consumer adapters, persistent histories, dashboard UI, or automatic production deployment are part of this implementation.
