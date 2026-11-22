# Senku agent skills

Choose the narrowest skill that covers the task. Skills point to the repository docs as the source of truth; update those docs when behavior changes rather than keeping a second copy of the contract in a skill.

| Skill | Use it for | Combine it with |
| --- | --- | --- |
| [`api-discovery-contracts`](api-discovery-contracts/SKILL.md) | REST routes, auth, permissions, OpenAPI, UTCP, schemas, and API errors | `profile-contract-authoring` for profile changes; `jev-provider-integration` for provider behavior |
| [`cloudflare-worker-operations`](cloudflare-worker-operations/SKILL.md) | Worker runtime, configuration, secrets, deployment, and readiness | `security-workflow-review` for Actions permissions, pins, environment protections, or deployment gates |
| [`jev-provider-integration`](jev-provider-integration/SKILL.md) | OpenRouter requests and responses, timeouts, errors, usage, and provider-facing evidence | `api-discovery-contracts` or `profile-contract-authoring` when public contracts also change |
| [`profile-contract-authoring`](profile-contract-authoring/SKILL.md) | Server-owned decision profiles, evidence, answer contracts, validation, permissions, and profile tests | `api-discovery-contracts` for REST or discovery surfaces; `jev-provider-integration` for provider behavior |
| [`security-workflow-review`](security-workflow-review/SKILL.md) | GitHub Actions, dependency automation, CI permissions, deployment gates, and cross-cutting security boundaries | `cloudflare-worker-operations` when Worker deployment configuration or readiness is involved |
| [`consumer-integration-migration`](consumer-integration-migration/SKILL.md) | Coordinated Senku, Kaseki, and Soyuz contract or transport changes | The domain skill for every Senku surface being changed |
| [`decision-calibration-and-replay`](decision-calibration-and-replay/SKILL.md) | Offline evaluation of profile probabilities against replayable outcomes | `profile-contract-authoring` when profile behavior or versioning also changes |
| [`local-development-and-validation`](local-development-and-validation/SKILL.md) | Local setup, choosing checks, and ordinary repository validation | The domain skill for the code or configuration under change |

## Choosing combinations

- Start with the skill that owns the primary code surface. Add another only when the task crosses that skill's boundary; a profile change alone does not require the provider or workflow skill.
- The Cloudflare skill owns Worker configuration and operational readiness. The security skill owns GitHub Actions trust, permissions, pinned actions, and governance. Use both when changing the deployment path end to end.
- The security skill is for workflow changes and cross-cutting trust boundaries. For a route, profile, or provider task, use the matching domain skill and add security guidance only if a shared boundary also changes.
- Use `consumer-integration-migration` when a contract or transport change needs coordinated work in Senku and a consumer. Use `decision-calibration-and-replay` for offline outcome analysis; it does not replace profile contract review.
- For review-only requests, follow the skill's Review mode and keep the work read-only. Change mode applies when implementation is requested. Run validation for changes or when the user asks for verification, not for a read-only review by default.

## Skill maintenance

Run `npm run validate:skills` after changing these files. It checks skill frontmatter and directory names, index coverage, and local Markdown links; CI runs the same check.
