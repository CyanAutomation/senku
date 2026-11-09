import { LIMITS, SCHEMA_VERSION } from "../contracts/decisions";
import type { JsonSchema } from "../contracts/profiles";
import { canEvaluateProfile, type ClientIdentity, type ProfileId } from "../auth/permissions";
import { profileRegistry } from "../decisions/profile-registry";
import {
  listPublicProfiles,
  profileAnswersSchema,
  profileEvaluationRequestSchema,
  profileEvaluationResponseSchema,
} from "./profile-contracts";

export const UTCP_VERSION = "1.1";
export const UTCP_MANUAL_VERSION = "1.0.0";
export const UTCP_MANUAL_NAME = "senku";
export const UTCP_API_TOKEN_VARIABLE = "SENKU_API_TOKEN";
const UTCP_API_TOKEN_PLACEHOLDER = "${" + UTCP_API_TOKEN_VARIABLE + "}";

interface UtcpAuth {
  auth_type: "api_key";
  api_key: string;
  var_name: "Authorization";
  location: "header";
}

interface UtcpHttpCallTemplate {
  name: string;
  call_template_type: "http";
  url: string;
  http_method: "POST";
  content_type: "application/json";
  body_field: "request";
  auth: UtcpAuth;
}

interface UtcpTool {
  name: string;
  description: string;
  inputs: JsonSchema;
  outputs: JsonSchema;
  tags: string[];
  tool_call_template: UtcpHttpCallTemplate;
}

export interface UtcpManual {
  utcp_version: string;
  manual_version: string;
  tools: UtcpTool[];
}

interface ToolDefinition {
  name: string;
  description: string;
  profileId: ProfileId;
  tags: string[];
}

const toolDefinitions = {
  assess_task_admission: {
    name: "assess_task_admission",
    profileId: "task_admission_v1",
    tags: ["decision", "kaseki", "task-admission"],
    description: "Classifies bounded repository and task evidence, including the repository URL/ref, task prompt, validation commands, changed-file allowlist, and task/publish modes. Returns advisory JEV assessments. It does not admit, reject, or authorize a Kaseki run; Kaseki's deterministic policy remains authoritative. Probabilities are not permissions.",
  },
  assess_validation_recovery: {
    name: "assess_validation_recovery",
    profileId: "validation_recovery_v1",
    tags: ["decision", "kaseki", "validation"],
    description: "Classifies a bounded validation command, exit code, and output to assess likely failure cause and recovery direction. Results are advisory; this tool does not execute commands or authorize retries, and Kaseki's deterministic retry policy remains authoritative. Probabilities are not permissions.",
  },
  triage_run_evidence: {
    name: "triage_run_evidence",
    profileId: "run_operations_triage_v1",
    tags: ["decision", "soyuz", "run-triage"],
    description: "Assesses bounded run status, stage, operational health, failure class, and lifecycle timestamps to classify follow-up need, likely area, and severity. Results are advisory; this tool does not change Soyuz run status or authorize an operational action. Probabilities are not permissions.",
  },
  review_kaseki_output_v1: {
    name: "review_kaseki_output_v1",
    profileId: "kaseki_output_review_v1",
    tags: ["decision", "soyuz", "output-review", "v1"],
    description: "Reviews bounded canonical run status, failure/exit metadata, changed-file count, and summary for specificity, outcome alignment, and evidence strength. Results are advisory; this tool does not approve, publish, or merge output. Probabilities are not permissions.",
  },
  review_kaseki_output_v2: {
    name: "review_kaseki_output_v2",
    profileId: "kaseki_output_review_v2",
    tags: ["decision", "soyuz", "output-review", "v2"],
    description: "Reviews the same bounded canonical run evidence as output-review v1 and also assesses alignment with a recorded outcome. Results are advisory; this tool does not approve, publish, or merge output. Probabilities are not permissions.",
  },
} as const satisfies Record<string, ToolDefinition>;

const toolDefinitionByProfile = new Map<ProfileId, ToolDefinition>(
  Object.values(toolDefinitions).map((definition) => [definition.profileId, definition]),
);

function extensionNotes(schema: Record<string, unknown>): string[] {
  const notes: string[] = [];
  const maxBytes = schema["x-maxBytes"];
  if (typeof maxBytes === "number") notes.push(`Senku also enforces a UTF-8 byte limit of ${maxBytes} bytes.`);

  const protocols = schema["x-allowedProtocols"];
  if (Array.isArray(protocols) && protocols.every((value) => typeof value === "string")) {
    notes.push(`Allowed URI schemes: ${protocols.join(", ")}.`);
  }
  if (schema["x-disallowUserInfo"] === true) notes.push("The URI must not contain a username or password.");
  if (schema["x-disallowQuery"] === true) notes.push("The URI must not contain a query string.");
  if (schema["x-disallowFragment"] === true) notes.push("The URI must not contain a fragment.");

  const probabilitySum = schema["x-probabilitySum"];
  if (typeof probabilitySum === "number") {
    const tolerance = typeof schema["x-probabilityTolerance"] === "number" ? schema["x-probabilityTolerance"] : 0;
    notes.push(`Senku validates that probabilities sum to ${probabilitySum} within tolerance ${tolerance}.`);
  }
  if (typeof schema["x-maxDepth"] === "number") notes.push(`Senku also enforces a maximum JSON content depth of ${schema["x-maxDepth"]}.`);
  if (typeof schema["x-maxNodes"] === "number") notes.push(`Senku also enforces a maximum of ${schema["x-maxNodes"]} JSON content nodes.`);

  return notes;
}

const schemaMapKeys = new Set([
  "properties", "patternProperties", "definitions", "$defs", "dependentSchemas", "dependencies",
]);

const schemaChildKeys = new Set([
  "additionalProperties", "propertyNames", "items", "prefixItems", "contains", "contentSchema",
  "allOf", "anyOf", "oneOf", "not", "if", "then", "else", "unevaluatedItems", "unevaluatedProperties",
]);

function projectSchemaChild(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => projectSchemaChild(item));
  if (value && typeof value === "object") return projectJsonSchemaForUtcp(value as JsonSchema);
  return value;
}

function projectSchemaMap(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, projectSchemaChild(child)]));
}

/**
 * Projects the registered contract into the JSON Schema subset carried by UTCP.
 * Senku's runtime validator remains authoritative for byte and URL restrictions.
 */
export function projectJsonSchemaForUtcp(schema: JsonSchema): JsonSchema {
  if (typeof schema === "boolean") return schema;
  const source = schema as Record<string, unknown>;
  if ("$ref" in source || "$dynamicRef" in source || "$recursiveRef" in source) {
    throw new Error("UTCP projection does not accept unresolved JSON Schema references.");
  }

  const projected: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(source)) {
    if (key.startsWith("x-")) continue;
    projected[key] = schemaMapKeys.has(key)
      ? projectSchemaMap(value)
      : schemaChildKeys.has(key)
        ? projectSchemaChild(value)
        : value;
  }

  const notes = extensionNotes(source);
  if (notes.length > 0) {
    const description = typeof source.description === "string" ? source.description : "";
    projected.description = [description, ...notes].filter(Boolean).join(" ");
  }
  return projected as JsonSchema;
}

function isLoopbackHostname(hostname: string): boolean {
  if (hostname === "localhost" || hostname === "[::1]") return true;
  const parts = hostname.split(".");
  if (parts.length !== 4 || !parts.every((part) => /^\d+$/.test(part))) return false;
  const octets = parts.map((part) => Number(part));
  return octets.every((octet) => Number.isInteger(octet) && octet >= 0 && octet <= 255)
    && octets[0] === 127;
}

/** Returns a normalized trusted origin, or null if configuration is missing or unsafe. */
export function trustedSenkuOrigin(value: string | undefined): string | null {
  if (!value || value !== value.trim() || value.includes("?") || value.includes("#")) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }

  if (url.username || url.password || url.search || url.hash || (url.pathname !== "" && url.pathname !== "/")) return null;
  const local = isLoopbackHostname(url.hostname);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && local)) return null;
  return url.origin;
}

const projectedProfileSchemas = new Map<ProfileId, { inputs: JsonSchema; outputs: JsonSchema }>();

function schemasForProfile(profileId: ProfileId): { inputs: JsonSchema; outputs: JsonSchema } {
  let schemas = projectedProfileSchemas.get(profileId);
  if (!schemas) {
    const profile = profileRegistry.getProfile(profileId);
    schemas = {
      inputs: projectJsonSchemaForUtcp(profileEvaluationRequestSchema(profile)),
      outputs: projectJsonSchemaForUtcp(profileEvaluationResponseSchema(profile, profileAnswersSchema(profile))),
    };
    projectedProfileSchemas.set(profileId, schemas);
  }
  return schemas;
}

export function buildUtcpManual(identity: ClientIdentity, configuredBaseUrl: string | undefined): UtcpManual | null {
  const origin = trustedSenkuOrigin(configuredBaseUrl);
  if (!origin) return null;

  const visibleProfiles = listPublicProfiles(identity);
  const tools: UtcpTool[] = visibleProfiles.map(({ id }) => {
    const profileId = id as ProfileId;
    const definition = toolDefinitionByProfile.get(profileId);
    if (!definition || !canEvaluateProfile(profileId, identity)) throw new Error("UTCP profile policy is inconsistent.");
    const schemas = schemasForProfile(profileId);
    return {
      name: definition.name,
      description: definition.description,
      inputs: {
        type: "object",
        required: ["request"],
        additionalProperties: false,
        description: "Supply the complete Senku evaluation request under request. The HTTP call template sends this value as the exact JSON body.",
        properties: { request: schemas.inputs },
      },
      outputs: schemas.outputs,
      tags: [...definition.tags],
      tool_call_template: {
        name: UTCP_MANUAL_NAME,
        call_template_type: "http",
        url: `${origin}/v1/profiles/${profileId}/evaluate`,
        http_method: "POST",
        content_type: "application/json",
        body_field: "request",
        auth: {
          auth_type: "api_key",
          api_key: `Bearer ${UTCP_API_TOKEN_PLACEHOLDER}`,
          var_name: "Authorization",
          location: "header",
        },
      },
    };
  });

  const manual: UtcpManual = { utcp_version: UTCP_VERSION, manual_version: UTCP_MANUAL_VERSION, tools };
  if (tools.length !== visibleProfiles.length || tools.some((tool) => !tool.name || tool.tool_call_template.http_method !== "POST")) {
    throw new Error("Generated UTCP manual failed its structural checks.");
  }
  return manual;
}

export function utcpManualResponseSchema(identity: ClientIdentity): JsonSchema {
  const manual = buildUtcpManual(identity, "https://senku.example.invalid");
  if (!manual) throw new Error("The static UTCP response-schema origin is invalid.");
  const toolSchemas = manual.tools.map((tool) => ({
    type: "object",
    required: ["name", "description", "inputs", "outputs", "tags", "tool_call_template"],
    additionalProperties: false,
    properties: {
      name: { type: "string", const: tool.name },
      description: { type: "string", const: tool.description },
      inputs: tool.inputs,
      outputs: tool.outputs,
      tags: {
        type: "array",
        minItems: tool.tags.length,
        maxItems: tool.tags.length,
        items: { type: "string", enum: tool.tags },
      },
      tool_call_template: {
        type: "object",
        required: ["name", "call_template_type", "url", "http_method", "content_type", "body_field", "auth"],
        additionalProperties: false,
        properties: {
          name: { type: "string", const: UTCP_MANUAL_NAME },
          call_template_type: { type: "string", const: "http" },
          url: { type: "string", format: "uri", description: `Trusted Senku origin plus the fixed profile route for ${tool.name}.` },
          http_method: { type: "string", const: "POST" },
          content_type: { type: "string", const: "application/json" },
          body_field: { type: "string", const: "request" },
          auth: {
            type: "object",
            required: ["auth_type", "api_key", "var_name", "location"],
            additionalProperties: false,
            properties: {
              auth_type: { type: "string", const: "api_key" },
              api_key: { type: "string", const: `Bearer ${UTCP_API_TOKEN_PLACEHOLDER}` },
              var_name: { type: "string", const: "Authorization" },
              location: { type: "string", const: "header" },
            },
          },
        },
      },
    },
  } as JsonSchema));

  return {
    type: "object",
    required: ["utcp_version", "manual_version", "tools"],
    additionalProperties: false,
    properties: {
      utcp_version: { type: "string", const: UTCP_VERSION },
      manual_version: { type: "string", const: UTCP_MANUAL_VERSION },
      tools: {
        type: "array",
        minItems: toolSchemas.length,
        maxItems: toolSchemas.length,
        items: { oneOf: toolSchemas },
      },
    },
  };
}

const manualCache = new Map<ClientIdentity, { origin: string; json: string }>();

export function serializeUtcpManual(identity: ClientIdentity, configuredBaseUrl: string | undefined): string | null {
  const origin = trustedSenkuOrigin(configuredBaseUrl);
  if (!origin) return null;

  const cached = manualCache.get(identity);
  if (cached?.origin === origin) return cached.json;

  const manual = buildUtcpManual(identity, origin);
  if (!manual) return null;
  const json = JSON.stringify(manual);
  manualCache.set(identity, { origin, json });
  return json;
}

export function utcpManualToolNames(identity: ClientIdentity): string[] {
  return listPublicProfiles(identity).map(({ id }) => {
    const definition = toolDefinitionByProfile.get(id as ProfileId);
    if (!definition || !canEvaluateProfile(id, identity)) throw new Error("UTCP profile policy is inconsistent.");
    return definition.name;
  });
}

export const UTCP_REQUEST_BYTES = LIMITS.requestBytes;
export const UTCP_SCHEMA_VERSION = SCHEMA_VERSION;
