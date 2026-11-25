# Persistence and retention boundary

Senku remains a stateless decisioning and evaluation Worker. It has no D1, KV, R2, Queue, or Durable Object binding and does not maintain decision history. Its UTCP manual cache is process-local and is an optimization, not a durable record store. Senku returns bounded, versioned decision responses to an authorized caller; where a decision must be retained as run evidence, Soyuz persists the structured result and evidence references under the canonical run's expiry.

Factory-owned decision evidence, profile identity/version, model identity where available, bounded token usage, duration, and outcome follow the same maximum 90-day deadline anchored to Soyuz's canonical run creation. Senku should not copy complete prompts, provider responses, or evaluation histories into a local store. Existing profile and decision contracts remain the source contracts; Soyuz maps their versioned fields into its persistence projection rather than redefining them.

This repository review found no durable decision database, independent run history, or persistent cache. Worker/application logging and provider-side inference retention are controlled outside the Senku D1/R2 surface. Available read-only infrastructure inspection did not confirm Cloudflare Workers Logs/Traces, AI Gateway, or inference-provider retention settings, so no physical deletion claim is made for those systems. Check account/provider retention separately before production data is routed.

The cross-service contract reference is [Soyuz Phase ABC persistence and retention](https://github.com/CyanAutomation/soyuz/blob/main/docs/PHASE-ABC-PERSISTENCE-RETENTION.md). No Senku deployment or decision-model change is part of this persistence phase.
