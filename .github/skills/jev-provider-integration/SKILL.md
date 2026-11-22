---
name: jev-provider-integration
description: Change Senku's JEV/OpenRouter request, response validation, timeout, provider errors, usage, or provider-facing evidence projection. Use when modifying provider integration behavior. Pair with api-discovery-contracts or profile-contract-authoring when public contracts also change.
---

# JEV provider integration

Read the provider and API contracts in [CONTRACT.md](../../../docs/CONTRACT.md), [PROFILES.md](../../../docs/PROFILES.md), and [DEVELOPMENT.md](../../../docs/DEVELOPMENT.md). The provider boundary is implemented in `src/providers/openrouter/decisions.ts`; profile projection and invocation are in `src/decisions/profile-engine.ts` and `src/profiles/`.

## Provider invariants

- Use the fixed OpenRouter Decisions endpoint and the sole supported alias `~typesafe/jev-latest`. Do not accept a caller-selected URL, model, provider credential, retry count, or fallback.
- Make at most one provider attempt per evaluation. Preserve configured timeout bounds, the streamed 64 KiB response limit, request/evidence/question limits, and fail-closed configuration behavior.
- Validate the full provider answer set, answer types, choices, probability distributions, score ranges, and profile-specific output before returning success.
- Keep errors safe and classified. Never log or return credentials, evidence, prompts, raw provider responses, or stack traces. Preserve null confidence instead of estimating it.
- Profile projections must remain bounded and minimize caller evidence. Redact before truncating sensitive output tails where the profile contract requires it; explain that deterministic redaction patterns are incomplete.
- Usage is returned only when supplied and valid. Do not estimate cost or imply a provider spending limit is configured.

## Change procedure

1. Trace request construction, configuration resolution, fetch/timeout handling, bounded response reading, response validation, and profile output validation.
2. Add focused tests before changing behavior. Cover valid responses, malformed or oversized bodies, wrong answer sets/types, timeout and transport failures, invalid configuration, and proof that rejected inputs do not call the provider where applicable.
3. Implement the narrowest change while preserving one-attempt semantics and safe diagnostics. Update the API/profile documentation when externally visible behavior changes.
4. Keep live provider smoke testing separate. It makes one paid inference request and is not part of routine CI.

## Validate

Run focused provider/profile tests and then:

```sh
npm run typecheck
npm test
npm run build
```

Use `npm run smoke:provider` only when a live compatibility check is explicitly part of the task and the operator has arranged an appropriate spending limit. Do not use live calls to test routine validation or failure cases.

## Completion notes

Report any changes to provider request/response behavior, limits, error mapping, or evidence projection. Include tests run and clearly distinguish mocked validation from a live provider check.
