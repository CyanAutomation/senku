---
name: local-development-and-validation
description: Set up Senku locally, choose appropriate checks for a repository change, or explain the scope and safety of development commands.
---

# Local development and validation

Use [the development guide](../../../docs/DEVELOPMENT.md) as the source of truth for setup, environment values, and operations. Select a domain skill from [the skill index](../README.md) when the task changes API, profiles, provider behavior, Cloudflare operations, workflow security, consumer integration, or calibration.

## Local setup

- Use Node.js 26 and `npm ci` when dependencies need installation or the lockfile changes.
- Routine type checks, tests, performance smoke checks, and dry-run builds do not require Cloudflare credentials or an OpenRouter key.
- Use ignored `.dev.vars` for local values. Never paste, log, or commit secret values.

## Choose checks by task

- For code behavior changes, run focused tests first, then `npm run typecheck`, `npm test`, and `npm run build` as appropriate to the affected surface.
- For skill metadata, index, or link changes, run `npm run validate:skills`.
- Use `npm run perf:smoke` for performance measurement work. Its timings are local and informational, not production CPU measurements.
- `npm run build` is a Wrangler dry-run build. It does not deploy.
- `npm run smoke:provider` makes one paid live inference request. Use it only when the user explicitly asks for a live compatibility check and the operator has arranged an appropriate spending limit.
- `npm run deploy` and `wrangler secret put` change the remote Worker; never use them as routine validation.

For read-only reviews or documentation-only requests, do not edit files or run checks unless the user asks for changes or verification. For code changes, report the checks actually run and distinguish mocked tests, local builds, live provider checks, and remote operations.

## Completion notes

Summarize the affected surface, checks run, and any remaining external setup or readiness gate. Never report a local build or `/healthz` response as proof of authenticated production readiness.
