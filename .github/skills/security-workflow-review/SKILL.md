---
name: security-workflow-review
description: Review or change Senku's GitHub Actions workflows, dependency automation, CI permissions, deployment gates, or cross-cutting application security boundaries. For route, profile, or provider work, use the matching domain skill and add this one only when a shared trust boundary or workflow also changes.
---

# Senku security and workflow review

Review both the workflow and the application boundary it protects. Read `.github/workflows/ci.yml`, `.github/workflows/codeql.yml`, `.github/dependabot.yml`, [the development guide](../../../docs/DEVELOPMENT.md), and [the REST contract](../../../docs/CONTRACT.md) before changing automation.

## Existing controls to preserve

- CI checks out without persisted credentials, pins Actions to full commit SHAs, uses least-privilege job permissions, and deploys only from `main` after verification and workflow-security checks.
- Pull request dependency review blocks high and critical issues in runtime and development dependencies. Dependabot checks npm and GitHub Actions weekly with a cooldown.
- `workflow-security` runs actionlint and zizmor. CodeQL analyzes JavaScript/TypeScript on pull requests, main pushes, and a weekly schedule.
- The deployment job uses the protected `cloudflare` environment and checks `/healthz`; runtime provider and machine-token secrets are separate Worker secrets.
- Application credentials identify callers only through bearer authentication. The central profile permission matrix, bounded evidence, fixed provider target, safe errors/logs, and advisory-only outputs are security boundaries.

## Review mode

1. Trace triggers, permissions, checkout refs, token persistence, third-party actions, artifact/data flow, environment protection, concurrency, and deployment conditions. Check that untrusted pull request data cannot reach a privileged deployment job.
2. Keep reviews read-only. Report findings with file and line, impact, and evidence, and distinguish repository evidence from GitHub settings that cannot be observed in the checkout. Do not edit files or run tests unless the user asks for changes or verification.

## Change mode

1. For workflow changes, add or adjust static validation when it meaningfully catches regressions. Keep actionlint/zizmor and CodeQL wired into CI; do not add broad permissions to suppress findings.
2. For application security behavior, write a focused regression test before the code change. Cover unauthorized identities, caller-controlled identity or destination attempts, oversized or malformed inputs, secret leakage, and provider non-invocation where relevant.
3. Preserve pinned action SHAs and inspect upstream action/version changes before updating pins. Keep secrets out of logs and generated artifacts. Do not weaken branch/environment protections or turn routine checks into paid live provider requests.
4. Update [DEVELOPMENT.md](../../../docs/DEVELOPMENT.md) and repository governance guidance when required checks, secrets, deployment gates, or operator responsibilities change.

## Validate

For implementation work, run the relevant local checks and the repository CI equivalents:

```sh
npm run typecheck
npm test
npm run build
```

For workflow edits, ensure actionlint and zizmor pass in CI. For application changes, use focused security regression tests plus the relevant suite. Report external branch-protection settings as configuration to verify; workflow YAML alone cannot prove repository settings are enabled.

## Completion notes

List the changed trust boundaries and workflow gates, checks performed, and any GitHub settings or external controls that still require operator verification. Distinguish automated findings from settings that were not observable in the repository.
