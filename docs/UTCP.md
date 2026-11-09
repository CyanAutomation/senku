# Senku UTCP discovery and client use

Senku publishes an authenticated UTCP manual at `GET /utcp`. UTCP discovery describes the existing profile REST routes; it does not add an execution route, inference handler, MCP server, or proxy. A client discovers tools with its machine identity, then calls the advertised profile URL directly with that same bearer identity.

## Versions and interoperability

Senku uses the stable UTCP protocol/manual schema version `1.1` and identifies its own manual as `1.0.0`. The manual uses `utcp_version`, `manual_version`, and `tools`; each tool includes `inputs`, `outputs`, `tags`, and a native HTTP `tool_call_template`.

The interoperability tests use the published `@utcp/sdk` `1.2.0` and `@utcp/http` `1.1.14` packages. Both are development dependencies only. Tests call the real `UtcpClient` and HTTP plugin. Senku runs inside the Cloudflare Vitest/workerd runtime, and a test-only fetch bridge routes the client's local HTTP requests into that Worker; the provider response is separately mocked. The bridge is test harness plumbing, not a Senku runtime proxy. The HTTP plugin itself handles manual registration, authentication substitution, request serialization, and invocation.

There are two verified client limitations to account for:

- The SDK's `JsonSchema` type describes a draft-07-based schema shape. The manual serializer accepts and preserves schema objects, but it is not a semantic JSON Schema 2020-12 validator. The HTTP client does not validate tool arguments against the published schema before sending them. Senku therefore remains authoritative for input validation; callers must not treat client-side validation as a replacement.
- The `@utcp/http` 1.1.14 README shows legacy API-key fields `api_key_value` and `in`. Its installed declaration, serializer, and runtime instead use `api_key`, `var_name`, and `location`. Senku emits and tests the runtime-supported form below. Do not copy the stale README fields for this version.

Senku projects profile contracts into the JSON Schema vocabulary carried by UTCP. Standard constraints and nested object/array shapes are retained. Senku-specific `x-` constraints such as UTF-8 byte limits and URL restrictions are omitted as keywords and summarized in descriptions; runtime checks still enforce them. Unresolved `$ref` values are rejected by projection rather than emitted with uncertain client behavior. The current profile schemas do not require references. `const`, enums, nullable types, nested fields, and output unions are retained in the manual.

## Tool catalog

`GET /utcp` returns only tools that the bearer identity may evaluate:

| Tool | Profile | Identity | Route |
| --- | --- | --- | --- |
| `assess_task_admission` | `task_admission_v1` | Kaseki | `POST /v1/profiles/task_admission_v1/evaluate` |
| `assess_validation_recovery` | `validation_recovery_v1` | Kaseki | `POST /v1/profiles/validation_recovery_v1/evaluate` |
| `triage_run_evidence` | `run_operations_triage_v1` | Soyuz | `POST /v1/profiles/run_operations_triage_v1/evaluate` |
| `review_kaseki_output_v1` | `kaseki_output_review_v1` | Soyuz | `POST /v1/profiles/kaseki_output_review_v1/evaluate` |
| `review_kaseki_output_v2` | `kaseki_output_review_v2` | Soyuz | `POST /v1/profiles/kaseki_output_review_v2/evaluate` |

Kaseki receives exactly the first two tools; Soyuz receives exactly the last three. The generic `POST /v1/decisions` endpoint is deliberately excluded because it accepts trusted dynamic questions. There is no query parameter to select an identity. The central permission matrix applies again when each REST route is invoked.

Tool descriptions explain their bounded evidence, advisory result, limitations, and the fact that probabilities do not grant operational permission. These tools do not admit runs, execute commands, approve retries, change run state, publish branches, or merge pull requests. The consumer retains deterministic authority.

## Authentication and trusted URLs

Configure the manual request with a client-side bearer variable. Each discovered tool carries the same placeholder for invocation:

```json
{
  "auth_type": "api_key",
  "api_key": "Bearer ${SENKU_API_TOKEN}",
  "var_name": "Authorization",
  "location": "header"
}
```

The operator supplies the Kaseki or Soyuz token to the local UTCP client. The manual contains only the variable placeholder. It never includes either configured machine secret or `OPENROUTER_API_KEY`; the provider key is not sent to the client. The same identity must be used for discovery and invocation.

The advertised invocation origin comes from the trusted `SENKU_PUBLIC_BASE_URL` configuration. Production origins must use HTTPS. HTTP is permitted only for loopback hosts in local development. Credentials, query strings, fragments, and non-root paths are rejected. Senku never derives tool URLs from `Host` or `X-Forwarded-Host`; an invalid or missing origin fails closed. Set the production origin in Worker configuration and use the local override in `.dev.vars`.

## Official TypeScript client example

With dependencies installed, run the Worker on `127.0.0.1:8787` and set `SENKU_API_TOKEN` to one of the two configured local machine tokens. This example uses the published SDK and plugin directly:

```ts
import { HttpCallTemplateSerializer } from "@utcp/http";
import { UtcpClient, UtcpClientConfigSerializer } from "@utcp/sdk";

const token = process.env.SENKU_API_TOKEN;
if (!token) throw new Error("Set SENKU_API_TOKEN to a local Senku machine token.");

const manualTemplate = new HttpCallTemplateSerializer().validateDict({
  name: "senku",
  call_template_type: "http",
  url: "http://127.0.0.1:8787/utcp",
  http_method: "GET",
  content_type: "application/json",
  auth: {
    auth_type: "api_key",
    api_key: "Bearer ${SENKU_API_TOKEN}",
    var_name: "Authorization",
    location: "header",
  },
});

const config = new UtcpClientConfigSerializer().validateDict({
  // UTCP isolates variables by manual name. `senku` is the template name.
  variables: { senku_SENKU_API_TOKEN: token },
  manual_call_templates: [manualTemplate],
});

const client = await UtcpClient.create(process.cwd(), config);
try {
  // This fetches and registers GET /utcp using the configured bearer token.
  console.log((await client.getTools()).map((tool) => tool.name));

  const result = await client.callTool("senku.assess_task_admission", {
    request: {
      schemaVersion: "1",
      input: {
        repoUrl: "https://example.com/repository",
        taskPrompt: "Assess this bounded example task.",
      },
    },
  });
  console.log(result);
} finally {
  await client.close();
}
```

Use `senku.triage_run_evidence` and a Soyuz token for a Soyuz example. Replace the tool argument's `request` with the exact envelope and profile fields described in [PROFILES.md](PROFILES.md). The profile input schemas are included under the outer `request` property in the manual.

## Exact request-body mapping

Every tool declares an input object with a required `request` property whose schema is the complete profile evaluation envelope. Its HTTP call template contains:

```json
{
  "http_method": "POST",
  "content_type": "application/json",
  "body_field": "request"
}
```

The official plugin removes `request` from the outer tool arguments and sends its value as the JSON body. For example, the task-admission call above sends exactly:

```json
{
  "schemaVersion": "1",
  "input": {
    "repoUrl": "https://example.com/repository",
    "taskPrompt": "Assess this bounded example task."
  }
}
```

There is no wrapper around this body, no query string for a valid invocation, and no second discovery or resolution call. An HTTP 200 result uses the existing REST response envelope.

## Security and architecture boundaries

- Discovery is authenticated, `no-store`, and permission-filtered. Missing/invalid credentials are rejected, and invalid service configuration fails closed.
- Kaseki cannot invoke a Soyuz profile and Soyuz cannot invoke a Kaseki profile. Manual arguments cannot select identity, profile, provider model, JEV question, or destination URL.
- Each URL uses the trusted configured origin and a fixed route generated from the allowed profile registry. Host headers cannot redirect it.
- Discovery performs no inference. Invalid, forbidden, malformed, unsupported-version, and oversized requests are rejected before provider invocation. Server errors do not include raw evidence or credentials.
- Senku's manual describes decision evaluation only. Future Soyuz UTCP belongs in the Soyuz repository and will describe Soyuz-owned run-management operations. Neither requires an MCP-compatible proxy for native UTCP invocation.

The production HTTPS hostname is configured as `https://senku.scheimann.workers.dev`, but the Worker has not been deployed and remote UTCP interoperability has not been verified. See [PHASE-2D-DEPLOYMENT.md](PHASE-2D-DEPLOYMENT.md) for the current gate and verification procedure. For local tests and performance measurements, see [DEVELOPMENT.md](DEVELOPMENT.md) and [PHASE-2C-DECISIONS.md](PHASE-2C-DECISIONS.md).
