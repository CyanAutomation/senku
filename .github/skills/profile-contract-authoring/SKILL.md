---
name: profile-contract-authoring
description: Create or change Senku decision profiles, their evidence and answer contracts, profile permissions, validation, or profile tests. Use when a task changes a registered profile or adds a new one.
---

# Authoring Senku profile contracts

Use this skill when changing the server-owned, versioned decision profiles. Start with [the profile contract guide](../../../docs/PROFILES.md), [the REST contract](../../../docs/CONTRACT.md), and the relevant profile implementation under `src/profiles/`.

## Preserve the contract boundary

- Callers provide bounded evidence in `{ "schemaVersion": "1", "input": ... }`; Senku owns the questions, answer IDs, provider settings, and output validation.
- Results are advisory. They never authorize admission, execution, retries, code changes, publication, queue transitions, or other side effects. Consumer-side deterministic policy remains authoritative.
- Do not add caller-controlled question definitions, provider URLs, or model names.
- Preserve nullable confidence. A consumer must treat `null` as unavailable or conservatively block confidence-dependent decisions; never manufacture a high confidence value.
- Keep evidence minimal, validated, bounded, and redacted where the profile requires it. Document residual limits of pattern-based redaction.

## Change procedure

1. Identify the profile owner and current permission in `src/auth/permissions.ts`, and inspect the registered profile, its validator, question builder, output validator, and public schemas.
2. Decide compatibility before editing. Changes to required input, question meaning, answer IDs or labels, score scale, or result shape require a new versioned profile ID. Keep the old version available unless the task explicitly changes the migration plan. A compatible implementation correction may keep the ID; record the rationale in `docs/PHASE-2B-DECISIONS.md`.
3. For behavior changes, write or update focused regression tests first. Cover valid and invalid inputs, output validation, ownership/permission, byte and question limits, and dynamic question IDs as applicable. Then implement the smallest change that passes those tests.
4. Keep the JSON Schema and domain validator aligned. Schemas reject undeclared fields; domain validation handles semantic rules that schemas cannot express reliably, such as URL credentials and parsed timestamp relationships.
5. Update profile documentation and any derived public surface. Registry metadata and public discovery must continue to derive from the central permission policy rather than duplicate client lists.

## Validate

Run the relevant tests while developing, then the repository checks for a profile contract change:

```sh
npm run typecheck
npm test
npm run build
```

The tests include runtime/schema parity, profile behavior, permission checks, REST routes, OpenAPI, and UTCP. If question counts or projected sizes change, check that they remain within both global and profile-specific bounds. Do not use a live provider smoke test for routine validation; it is a paid, opt-in request.

## Completion notes

Summarize the profile IDs affected, compatibility decision, changed public contract surfaces, tests run, and any consumer migration required. Do not imply that a profile assessment grants operational authority.
