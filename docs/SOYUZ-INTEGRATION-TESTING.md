# Soyuz integration testing

Senku keeps an offline Service Binding test for the Soyuz decision boundary. It runs the real Senku Worker in Wrangler's local Workers runtime and binds it to a test-only Soyuz dashboard/client simulator.

## Offline simulator

Run it with:

```sh
npm run test:soyuz-simulator
```

The simulator follows the current Soyuz integration shape: a dashboard decision request identifies an approved profile and a retained run; the caller projects a small, bounded input; it calls Senku's `POST /v1/profiles/{profileId}/evaluate` route over a `SENKU` Service Binding using `SENKU_SOYUZ_API_TOKEN`; and it returns only the resolved model and validated answers. Synthetic run records include a private task prompt to verify that Soyuz's projection does not send it to Senku or expose it in routine logs.

Its run fields, retry relationship checks, evidence projections, request envelope, and response mapping mirror the current Soyuz implementation in [`src/jev/analysis.ts`](https://github.com/CyanAutomation/soyuz/blob/main/src/jev/analysis.ts), [`src/jev/senku-client.ts`](https://github.com/CyanAutomation/soyuz/blob/main/src/jev/senku-client.ts), and [`src/jev/senku-response.ts`](https://github.com/CyanAutomation/soyuz/blob/main/src/jev/senku-response.ts). The fixture records are shaped after [`src/db/runs.ts`](https://github.com/CyanAutomation/soyuz/blob/main/src/db/runs.ts). It exercises all four Soyuz-owned profiles: run operations triage, both output review versions, and retry review.

The provider is mocked, and the test blocks outbound requests other than the mock OpenRouter endpoint. It requires neither live credentials nor a Cloudflare account. The simulator does not reproduce Soyuz's full OAuth implementation, D1 persistence, dashboard authorization, or run lifecycle. Its purpose is to test the Service Binding protocol and Senku's real profile routes with realistic evidence projections.

## Full Soyuz cross-worker test

Soyuz also maintains a stronger integration test that runs its actual Worker, applies local D1 migrations, exchanges a synthetic OAuth fixture, creates a run, calls the real Senku Worker over the configured Service Binding, and checks that the analysis does not change the canonical run. Its OpenRouter call is mocked. From a Soyuz checkout with dependencies installed, run:

```sh
SENKU_WRANGLER_CONFIG=/absolute/path/to/senku/wrangler.jsonc npm run test:cross-worker
```

See [`scripts/senku-cross-worker.test.ts`](https://github.com/CyanAutomation/soyuz/blob/main/scripts/senku-cross-worker.test.ts). Running that test is the preferred full integration check when both repositories are available locally; the Senku simulator keeps the protocol and all profile contracts covered from Senku's CI without cloning or installing Soyuz.
