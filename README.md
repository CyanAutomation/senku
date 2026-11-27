# Senku

Senku is a stateless Cloudflare Worker that provides bounded, typed JEV decisions to Kaseki-Agent, Soyuz, and Rusty-Fossil.

The public interface is described in [docs/CONTRACT.md](docs/CONTRACT.md), and the profile schemas are in [docs/PROFILES.md](docs/PROFILES.md). Deployment endpoints, account identifiers, active version details, and live usage belong in environment-specific operations systems and are intentionally omitted here.

## API

The Worker exposes health and readiness checks, permission-filtered OpenAPI and UTCP discovery, and profile evaluation:

- GET /healthz and /readyz
- GET /openapi.json and /docs/
- GET /utcp
- POST /v1/profiles/{profileId}/evaluate

Configure the API origin for each environment through deployment settings. Clients use an identity-scoped credential provisioned by the runtime's secret manager. Do not commit credential values or include them in logs.

## Profiles and access

Senku owns the JEV questions and schemas for its supported profiles. Each consumer receives only the profile access configured for its service identity. See [docs/PROFILES.md](docs/PROFILES.md) for the profile contracts and [docs/CONTRACT.md](docs/CONTRACT.md) for request and response shapes.

The response format is additive: clients should validate the fields they depend on and ignore unknown top-level fields. Provider output is validated against the selected profile before it is returned.

## Runtime safeguards

- Caller deadlines and request correlation IDs bound and connect each evaluation.
- Provider retries are limited to short, explicitly retryable responses that fit inside the remaining deadline.
- A per-isolate circuit breaker and configured admission controls limit repeated work during upstream failures.
- Requests, evidence, provider responses, and runtime duration are bounded.
- Model selection is constrained by deployment configuration. Configure a provider-side spending allowance before enabling any live canary.
- Telemetry should contain operational metadata only. Do not log prompts, evidence, answers, credentials, or provider request bodies.

These controls do not replace environment-specific quota, billing, or consumer-routing checks. Use [docs/PHASE-2D-DEPLOYMENT.md](docs/PHASE-2D-DEPLOYMENT.md) as a generic release checklist.

## Local development

Install dependencies with npm install, then run npm test and npm run typecheck. Start a local Worker with npm run dev. For local UTCP discovery, use a loopback origin such as http://127.0.0.1:8787.

The routine test suite mocks the provider. The optional live-provider smoke test requires a dedicated test credential and should only run after an allowance has been confirmed. See [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) for test and build guidance.

## Related documentation

- [Contract](docs/CONTRACT.md)
- [Profiles](docs/PROFILES.md)
- [Development](docs/DEVELOPMENT.md)
- [Generic deployment checklist](docs/PHASE-2D-DEPLOYMENT.md)

## Project direction

The work focuses on explicit contracts, bounded provider behavior, consumer-specific access, and measured rollout practices. Any deployment status or live service details are maintained outside this public repository.
