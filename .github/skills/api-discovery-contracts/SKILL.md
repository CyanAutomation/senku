---
name: api-discovery-contracts
description: Change or review Senku REST routes, authentication and authorization behavior, OpenAPI, UTCP discovery, schemas, or error responses. Use when a public API or discovery surface changes. Pair with profile-contract-authoring for profile changes and jev-provider-integration for provider behavior.
---

# Senku API and discovery contracts

Read [the REST contract](../../../docs/CONTRACT.md), [UTCP guide](../../../docs/UTCP.md), and [profile contracts](../../../docs/PROFILES.md) before changing public behavior. The implementation is in `src/index.ts`, `src/api/`, `src/auth/`, `src/contracts/`, and `src/decisions/`.

## Invariants

- The permission matrix in `src/auth/permissions.ts` is authoritative. Identity comes from the matched bearer token, never the body, query, or identity headers. Enforce authorization before reading evidence or invoking the provider.
- Kaseki and Soyuz see only their permitted profiles. Unknown or forbidden profiles must not disclose profile details.
- Authenticated responses remain `Cache-Control: no-store`; Senku does not enable CORS.
- `/openapi.json` and `/utcp` are authenticated and permission-filtered. Keep them aligned with the REST routes and registered profile schemas.
- UTCP describes direct calls to existing profile routes. It must not introduce a second evaluation path, caller-selected destination, generic question endpoint, or identity override.
- Keep the established error envelope and safe error behavior. Do not return evidence, prompts, provider responses, secrets, or stack traces.
- OpenAPI is 3.1. UTCP schema projection must reflect actual SDK/client behavior documented in `docs/UTCP.md`; do not assume the client validates arguments.

## Review mode

Keep review requests read-only. Trace the route through authentication, permissions, profile selection, and serialization; compare the public REST, OpenAPI, and UTCP surfaces with the documented contracts. Report actionable findings first with file and line, impact, and evidence. Separate confirmed defects from missing test coverage. Do not edit files or run tests unless the user asks for changes or verification.

## Change mode

1. Trace the route from `src/index.ts` through auth, permission checks, profile registry, and response serialization before editing.
2. For behavior changes, add failing route or contract tests first. Include both identities, forbidden access, malformed and oversized requests, cache headers, and discovery filtering when relevant. Then make the implementation change.
3. Update generated or registry-derived OpenAPI and UTCP behavior from the same source contracts; avoid hand-maintained duplicate profile lists.
4. Update `docs/CONTRACT.md`, `docs/UTCP.md`, and/or `docs/PROFILES.md` whenever a documented public contract changes.

## Validate

For implementation work, run focused tests first, then:

```sh
npm run typecheck
npm test
npm run build
```

`npm test` includes independent OpenAPI validation. UTCP interoperability tests exercise the installed official client. Keep any changes compatible with those observed client behaviors, and do not replace local mocked tests with a live provider call.

## Completion notes

Report affected routes and identities, contract/documentation changes, checks run, and any client migration needed.
