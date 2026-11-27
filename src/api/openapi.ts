import { ERROR_CODES, LIMITS, SCHEMA_VERSION } from "../contracts/decisions";
import type { AnyDecisionProfile, JsonSchema } from "../contracts/profiles";
import type { ClientIdentity } from "../auth/permissions";
import { profileRegistry } from "../decisions/profile-registry";
import { utcpManualResponseSchema } from "./utcp";
import { MAX_RETRY_AFTER_SECONDS } from "../http/retry-after";
import {
  listPublicProfiles,
  profileAnswersSchema,
  profileEvaluationRequestSchema,
  profileEvaluationResponseSchema,
  profileOutputSchema,
} from "./profile-contracts";

const ref = (name: string): JsonSchema => ({ $ref: `#/components/schemas/${name}` });
const inputName = (id: string): string => `Profile_${id}_Input`;
const answerName = (id: string): string => `Profile_${id}_Answers`;
const evaluationRequestName = (id: string): string => `Profile_${id}_EvaluationRequest`;
const evaluationResponseName = (id: string): string => `Profile_${id}_EvaluationResponse`;
const contractName = (id: string): string => `Profile_${id}_Contract`;

function response(schema: JsonSchema, description: string): Record<string, unknown> {
  return { description, content: { "application/json": { schema } } };
}

function htmlResponse(description: string): Record<string, unknown> {
  return { description, content: { "text/html": { schema: { type: "string" } } } };
}

function commonErrors(statuses: readonly number[]): Record<string, unknown> {
  const descriptions: Record<number, string> = {
    400: "The request body, schema version, or profile input is invalid.",
    401: "The bearer credential is missing or invalid.",
    403: "The authenticated identity is not permitted to use the requested operation.",
    404: "The route was not found.",
    405: "The HTTP method is not supported for this route.",
    413: "The request or evidence exceeds its configured byte limit.",
    415: "The request body must use application/json.",
    429: "The service or its provider is rate limiting requests.",
    500: "The service encountered an unexpected internal error.",
    502: "The provider is unavailable or returned an invalid result.",
    503: "The service is not configured or admission control is unavailable.",
    504: "The provider did not respond before the configured timeout.",
  };
  return Object.fromEntries(statuses.map((status) => {
    const errorResponse = response(ref("ErrorResponse"), descriptions[status]);
    if (status === 429 || status === 502) {
      errorResponse.headers = {
        "Retry-After": {
          description: "Optional bounded delay in seconds. A provider 429 may be retried once by Senku when the delay fits within the caller deadline; all other retries are the caller's decision.",
          schema: { type: "integer", minimum: 0, maximum: MAX_RETRY_AFTER_SECONDS },
        },
      };
    }
    return [String(status), errorResponse];
  }));
}

function profileMetadataProperties(id: JsonSchema = { type: "string" }): Record<string, JsonSchema> {
  return {
    id,
    version: { type: "string" },
    name: { type: "string" },
    description: { type: "string" },
    owner: { type: "string", enum: ["kaseki", "soyuz"] },
    questionCount: { type: "integer", minimum: 1 },
    dynamicQuestions: { type: "boolean" },
    maxEvidenceBytes: { type: "integer", minimum: 1 },
    operations: { type: "array", items: { type: "string", const: "evaluate" }, minItems: 1, maxItems: 1 },
  };
}

function profileContractSchema(id: string): JsonSchema {
  return {
    type: "object",
    required: ["schemaVersion", "id", "version", "name", "description", "owner", "questionCount", "dynamicQuestions", "maxEvidenceBytes", "operations", "inputSchema", "outputSchema", "limits", "evaluationEndpoint"],
    properties: {
      schemaVersion: { type: "string", const: SCHEMA_VERSION },
      ...profileMetadataProperties({ type: "string", const: id }),
      inputSchema: { type: "object", description: "JSON Schema 2020-12 for profile evidence." },
      outputSchema: { type: "object", description: "JSON Schema 2020-12 for the profile's canonical answer map." },
      limits: { type: "object", required: ["requestBytes", "maxEvidenceBytes", "questionCount"], properties: {
        requestBytes: { type: "integer", const: LIMITS.requestBytes },
        maxEvidenceBytes: { type: "integer" },
        questionCount: { type: "integer" },
      } },
      evaluationEndpoint: { type: "string", const: "/v1/profiles/{profileId}/evaluate" },
    },
    additionalProperties: false,
  };
}

function buildComponents(profiles: AnyDecisionProfile[], identity: ClientIdentity): Record<string, unknown> {
  const schemas: Record<string, JsonSchema> = {
    ErrorCode: { type: "string", enum: ERROR_CODES },
    ErrorResponse: { type: "object", required: ["error"], additionalProperties: false, properties: {
      error: { type: "object", required: ["code", "message", "retryable", "requestId"], additionalProperties: false, properties: {
        code: ref("ErrorCode"), message: { type: "string" }, retryable: { type: "boolean" }, requestId: { type: "string", pattern: "^dec-" },
      } },
    } },
    ProfileSummary: { type: "object", required: ["id", "version", "name", "description", "owner", "questionCount", "dynamicQuestions", "maxEvidenceBytes", "operations"], additionalProperties: false, properties: {
      ...profileMetadataProperties(),
    } },
    ProfileList: { type: "object", required: ["schemaVersion", "profiles"], additionalProperties: false, properties: {
      schemaVersion: { type: "string", const: SCHEMA_VERSION }, profiles: { type: "array", items: ref("ProfileSummary") },
    } },
    HealthResponse: { type: "object", required: ["status"], additionalProperties: false, properties: { status: { type: "string", const: "ok" } } },
    ReadyResponse: { type: "object", required: ["status"], additionalProperties: false, properties: { status: { type: "string", enum: ["ready", "not_ready"] } } },
    OpenApiDocument: { type: "object", required: ["openapi", "info", "paths", "components"], additionalProperties: true },
    UtcpManual: utcpManualResponseSchema(identity),
  };

  schemas.AgentStageSettings = {
    type: "object", additionalProperties: false, properties: {
      enabled: { type: "boolean" }, model: { type: "string", minLength: 1, maxLength: 256, "x-maxBytes": 256 }, timeoutSeconds: { type: "integer", minimum: 60, maximum: 10_800 },
    },
  };

  for (const profile of profiles) {
    schemas[inputName(profile.id)] = profile.inputSchema;
    schemas[answerName(profile.id)] = profileAnswersSchema(profile);
    schemas[evaluationRequestName(profile.id)] = profileEvaluationRequestSchema(profile, ref(inputName(profile.id)));
    schemas[evaluationResponseName(profile.id)] = profileEvaluationResponseSchema(profile, ref(answerName(profile.id)));
    schemas[contractName(profile.id)] = profileContractSchema(profile.id);
  }
  return { securitySchemes: { BearerAuth: { type: "http", scheme: "bearer", bearerFormat: "opaque", description: "Use the identity-specific Senku machine token." } }, schemas };
}

function profileIdsParameter(ids: string[]): Record<string, unknown> {
  return { name: "profileId", in: "path", required: true, schema: { type: "string", enum: ids } };
}

function evaluationHeaderParameters(): Record<string, unknown>[] {
  return [
    {
      name: "X-Correlation-Id", in: "header", required: false,
      description: "Optional identifier recorded in Senku's structured logs; 1–128 safe ASCII characters.",
      schema: { type: "string", pattern: "^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$" },
    },
    {
      name: "X-Senku-Deadline-Ms", in: "header", required: false,
      description: "Optional absolute Unix deadline in milliseconds. Provider work is bounded by the lesser of this remaining budget and Senku's configured timeout.",
      schema: { type: "string", pattern: "^[0-9]{13}$" },
    },
  ];
}

function createOpenApiDocument(identity: ClientIdentity): Record<string, unknown> {
  const publicProfiles = listPublicProfiles(identity);
  const profiles = publicProfiles.map(({ id }) => profileRegistry.getProfile(id));
  const profileIds = profiles.map((profile) => profile.id);
  const components = buildComponents(profiles, identity);
  const schemas = components.schemas as Record<string, JsonSchema>;
  const profileContractRefs = profiles.map((profile) => ref(contractName(profile.id)));
  const profileResponseRefs = profiles.map((profile) => ref(evaluationResponseName(profile.id)));
  const profileRequestRefs = profiles.map((profile) => ref(evaluationRequestName(profile.id)));
  const paths: Record<string, unknown> = {
    "/docs/": {
      get: {
        operationId: "getApiDocumentation",
        summary: "Browse the Senku API documentation",
        description: "Returns a self-contained HTML page. Enter a machine bearer token to load the identity-filtered OpenAPI document.",
        security: [],
        responses: {
          "200": htmlResponse("Self-contained API documentation page."),
          ...commonErrors([405]),
        },
      },
    },
    "/docs": {
      get: {
        operationId: "redirectToApiDocumentation",
        summary: "Redirect to the Senku API documentation",
        security: [],
        responses: {
          "308": {
            description: "Permanent redirect to /docs/.",
            headers: { Location: { description: "Documentation page path.", schema: { type: "string", const: "/docs/" } } },
          },
          ...commonErrors([405]),
        },
      },
    },
    "/v1/profiles": {
      get: {
        operationId: "listPermittedProfiles", summary: "List permitted decision profiles", security: [{ BearerAuth: [] }],
        responses: {
          "200": response(ref("ProfileList"), "Profiles allowed for the authenticated identity."),
          ...commonErrors([401, 405, 500, 503]),
        },
      },
    },
    "/v1/profiles/{profileId}": {
      get: {
        operationId: "getPermittedProfile", summary: "Get a permitted profile contract", security: [{ BearerAuth: [] }],
        parameters: [profileIdsParameter(profileIds)],
        responses: {
          "200": response({ oneOf: profileContractRefs }, "Public input and output schemas, limits, and operation for this profile."),
          ...commonErrors([400, 401, 403, 405, 500, 503]),
        },
      },
    },
    "/v1/profiles/{profileId}/evaluate": {
      post: {
        operationId: "evaluateProfile", summary: "Evaluate bounded evidence using a permitted profile", security: [{ BearerAuth: [] }],
        parameters: [profileIdsParameter(profileIds), ...evaluationHeaderParameters()],
        requestBody: { required: true, content: { "application/json": { schema: { oneOf: profileRequestRefs } } } },
        responses: {
          "200": response({ oneOf: profileResponseRefs }, "Stable version 1 profile evaluation response."),
          ...commonErrors([400, 401, 403, 405, 413, 415, 429, 500, 502, 503, 504]),
        },
      },
    },
    "/openapi.json": {
      get: {
        operationId: "getOpenApiDocument", summary: "Get this identity's permission-filtered OpenAPI document", security: [{ BearerAuth: [] }],
        responses: { "200": response(ref("OpenApiDocument"), "OpenAPI 3.1 document filtered to the authenticated identity."), ...commonErrors([401, 405, 500, 503]) },
      },
    },
    "/utcp": {
      get: {
        operationId: "getPermissionFilteredUtcpManual",
        summary: "Discover this identity's permitted Senku decision tools",
        security: [{ BearerAuth: [] }],
        responses: {
          "200": response(ref("UtcpManual"), "UTCP 1.1 manual containing only profiles permitted for the authenticated identity."),
          ...commonErrors([401, 405, 500, 503]),
        },
      },
    },
    "/healthz": {
      get: { operationId: "healthCheck", summary: "Check worker liveness", security: [], responses: { "200": response(ref("HealthResponse"), "Worker is running."), ...commonErrors([405]) } },
    },
    "/readyz": {
      get: { operationId: "readinessCheck", summary: "Check required service configuration", security: [], responses: {
        "200": response(ref("ReadyResponse"), "Required configuration is present and valid."),
        "503": response(ref("ReadyResponse"), "Required configuration is missing or invalid."),
        ...commonErrors([405]),
      } },
    },
  };

  const profileSchemas = Object.fromEntries(profiles.map((profile) => [profile.id, {
    input: schemas[inputName(profile.id)],
    output: profileOutputSchema(profile),
    envelope: schemas[evaluationRequestName(profile.id)],
  }]));
  return {
    openapi: "3.1.0",
    info: { title: "Senku Decision API", version: "1", description: "Authenticated, versioned JEV decision API. The document is filtered to the caller's profile permissions." },
    jsonSchemaDialect: "https://json-schema.org/draft/2020-12/schema",
    servers: [{ url: "/", description: "The current Senku origin." }],
    security: [{ BearerAuth: [] }],
    paths,
    components,
    "x-profileContracts": profileSchemas,
  };
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

const documentCache = new Map<ClientIdentity, { document: Record<string, unknown>; serialized: string }>();

function getOpenApiDocument(identity: ClientIdentity): { document: Record<string, unknown>; serialized: string } {
  let entry = documentCache.get(identity);
  if (!entry) {
    const document = deepFreeze(createOpenApiDocument(identity));
    entry = { document, serialized: JSON.stringify(document) };
    documentCache.set(identity, entry);
  }
  return entry;
}

export function buildOpenApiDocument(identity: ClientIdentity): Record<string, unknown> {
  return getOpenApiDocument(identity).document;
}

export function serializeOpenApiDocument(identity: ClientIdentity): string {
  return getOpenApiDocument(identity).serialized;
}
