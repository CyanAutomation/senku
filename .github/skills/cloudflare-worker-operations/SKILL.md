---
name: cloudflare-worker-operations
description: Develop, configure, troubleshoot, or prepare a deployment of Senku on Cloudflare Workers using the repository's Wrangler setup. Use for Worker runtime, environment, secret, deployment, or readiness tasks. Pair with security-workflow-review for GitHub Actions permissions, pins, or deployment gates.
---

# Senku Cloudflare Worker operations

Use the checked-in Wrangler configuration and local package scripts as the source of truth. Read [development and operations](../../../docs/DEVELOPMENT.md), [deployment status](../../../docs/PHASE-2D-DEPLOYMENT.md), and `wrangler.jsonc` before changing Worker settings. This project uses Wrangler 4 from `package-lock.json`, Node.js 26, native Fetch/Web Crypto APIs, and no Node.js compatibility mode.

For GitHub Actions triggers, permissions, action pins, or environment protections, also use `security-workflow-review`. This skill owns Worker target, configuration, readiness, and remote-operation details; the security skill owns workflow trust and governance.

## Safety and deployment boundaries

- `npm run build` invokes Wrangler's dry-run build; it does not deploy. `npm run deploy` and `wrangler secret put` change the remote Worker. Treat secret writes as deployments.
- Routine local checks and CI do not need Cloudflare credentials or an OpenRouter key. Never ask for secret values in chat or place them in source, Wrangler `vars`, shell arguments, or logs.
- Production deploys run from a successful push to `main` through the `cloudflare` GitHub Environment. Preserve its environment protection, pinned Actions, and least-privilege permissions when editing workflows.
- Cloudflare deployment credentials authorize deployment; they do not set Worker runtime secrets. Kaseki and Soyuz machine tokens are required, Rusty-Fossil is optional, and provider authorization is configured separately.
- `/healthz` proves liveness only. Production readiness and authenticated profile/UTCP checks are distinct gates. Do not report production as ready until documented secret configuration and verification are complete.
- The repository does not configure custom CPU or subrequest limits. Do not infer the live account plan from this checkout; local elapsed time is not billed production CPU measurement.

## Change procedure

1. Inspect the local Wrangler version, package scripts, compatibility date, variables, observability, and deployment workflow. Use the installed CLI/schema and current Cloudflare documentation for version-sensitive command or configuration claims; do not invent flags.
2. Make the smallest config or workflow change. Preserve the allowlisted model set, bounded timeout, trusted public UTCP origin, no-storage architecture, and secret separation unless the task explicitly changes those contracts.
3. For runtime/config behavior, add a focused regression test first where practical, then implement. Update the deployment and operations docs when a gate, secret, command, or operator action changes.
4. Before any remote command, verify the requested target account and Worker. A dry run or local test does not establish remote readiness.

## Validate

Use relevant checks, then the normal CI sequence for runtime or deployment changes:

```sh
npm ci
npm run typecheck
npm test
npm run build
```

The CI deploy job targets production only on `main`, after `verify` and `workflow-security`, and checks public `/healthz`. Do not run a deployment or secret mutation as a validation step unless the task explicitly requests that remote change. Follow [the deployment guide](../../../docs/PHASE-2D-DEPLOYMENT.md) for separate readiness and authenticated verification steps.

## Completion notes

State whether work was local, dry-run, or remote; name the target environment for remote work; list checks performed; and identify any unresolved readiness gate. Never describe a successful build or health check as proof of full production readiness.
