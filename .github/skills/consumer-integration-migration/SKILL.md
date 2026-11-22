---
name: consumer-integration-migration
description: Coordinate Senku decision-profile or transport changes with Kaseki-Agent or Soyuz, including REST and Service Binding integration, compatibility, staged rollout, and rollback.
---

# Consumer integration and migration

Use this skill when a task spans Senku and Kaseki-Agent or Soyuz. Start with [the REST contract](../../../docs/CONTRACT.md), [profile contracts](../../../docs/PROFILES.md), [UTCP guide](../../../docs/UTCP.md), and [development and operations](../../../docs/DEVELOPMENT.md). Check the current roadmap and the relevant consumer implementation before proposing a migration.

## Preserve the integration boundary

- Senku owns versioned profile questions, schemas, and result validation. Results are advisory; each consumer keeps deterministic policy and execution authority.
- REST and Service Binding are transports to the same authenticated profile routes. A transport change must not bypass bearer identity or the central profile permission matrix.
- Keep Kaseki and Soyuz identities separate, and preserve each consumer's allowed profiles.
- Do not assume a consumer's current behavior from Senku documentation alone. Inspect the available consumer source or an agreed contract snapshot; identify unknowns explicitly when that source is unavailable.

## Change procedure

1. Map the producer contract, consumer request and response handling, identity, and transport before editing either side.
2. Treat changes to required evidence, question meaning, answer IDs or labels, score scale, or result shape as a new versioned profile contract. Keep old versions available through the consumer migration unless the task specifies another plan.
3. Write focused compatibility tests in each affected repository. Verify the same envelope, profile permissions, nullable confidence handling, and safe failure behavior across both sides. Keep provider responses mocked for routine tests.
4. Make rollout order explicit. Prefer a backward-compatible Senku release first, then consumer adoption, then removal of old behavior only after compatibility is verified. Document a rollback path before production rollout.
5. Update the relevant Senku contract docs and consumer integration docs together. Record the profile versions and transport assumptions each side supports.

## Validate

Run the focused contract tests in every changed repository, then the relevant local checks from each repository's development guide. Do not use a live provider call or production deployment as routine validation. A health check does not prove authenticated consumer interoperability; verify the actual profile route and identity when an explicitly authorized integration check is required.

## Completion notes

Report repositories and components changed, profile versions and identities affected, transport and rollout order, checks run, and any compatibility or rollback gap that remains.
