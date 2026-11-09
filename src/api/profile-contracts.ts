import type { DecisionQuestion } from "../contracts/decisions";
import { LIMITS, SCHEMA_VERSION } from "../contracts/decisions";
import type { AnyDecisionProfile, JsonSchema, ProfileMetadata } from "../contracts/profiles";
import { canEvaluateProfile, type ClientIdentity, type ProfileId } from "../auth/permissions";
import { profileRegistry } from "../decisions/profile-registry";

export interface PublicProfileMetadata {
  id: string;
  version: string;
  name: string;
  description: string;
  owner: "kaseki" | "soyuz";
  questionCount: number;
  maxEvidenceBytes: number;
  operations: ["evaluate"];
}

export interface PublicProfileContract extends PublicProfileMetadata {
  schemaVersion: typeof SCHEMA_VERSION;
  inputSchema: JsonSchema;
  outputSchema: JsonSchema;
  limits: {
    requestBytes: number;
    maxEvidenceBytes: number;
    questionCount: number;
  };
  evaluationEndpoint: "/v1/profiles/{profileId}/evaluate";
}

function registeredProfileMetadata(identity: ClientIdentity): Array<{ metadata: ProfileMetadata; profile: AnyDecisionProfile }> {
  return profileRegistry.listProfiles()
    .filter((metadata) => canEvaluateProfile(metadata.id as ProfileId, identity))
    .map((metadata) => ({ metadata, profile: profileRegistry.getProfile(metadata.id) }));
}

export function listPublicProfiles(identity: ClientIdentity): PublicProfileMetadata[] {
  return registeredProfileMetadata(identity).map(({ metadata }) => ({
    id: metadata.id,
    version: metadata.version,
    name: metadata.name,
    description: metadata.description,
    owner: metadata.owner,
    questionCount: metadata.questionCount,
    maxEvidenceBytes: metadata.maxEvidenceBytes,
    operations: ["evaluate"],
  }));
}

export function getPublicProfileContract(profileId: string): PublicProfileContract {
  const profile = profileRegistry.getProfile(profileId);
  const questionCount = Object.keys(profile.questions).length;
  return {
    schemaVersion: SCHEMA_VERSION,
    id: profile.id,
    version: profile.version,
    name: profile.name,
    description: profile.description,
    owner: profile.owner,
    questionCount,
    maxEvidenceBytes: profile.maxEvidenceBytes,
    operations: ["evaluate"],
    inputSchema: profile.inputSchema,
    outputSchema: profileOutputSchema(profile),
    limits: {
      requestBytes: LIMITS.requestBytes,
      maxEvidenceBytes: profile.maxEvidenceBytes,
      questionCount,
    },
    evaluationEndpoint: "/v1/profiles/{profileId}/evaluate",
  };
}

function questionAnswerSchema(question: DecisionQuestion): JsonSchema {
  if (question.type === "noul") {
    return {
      type: "object",
      required: ["type", "noul", "probabilities", "confidence"],
      additionalProperties: false,
      properties: {
        type: { type: "string", const: "noul" },
        noul: { type: "number", minimum: 0, maximum: 1 },
        probabilities: {
          type: "object",
          required: ["false", "true"],
          additionalProperties: false,
          "x-probabilitySum": 1,
          "x-probabilityTolerance": LIMITS.probabilityTolerance,
          properties: { false: { type: "number", minimum: 0, maximum: 1 }, true: { type: "number", minimum: 0, maximum: 1 } },
        },
        confidence: { type: "null", const: null },
      },
    };
  }

  if (question.type === "choice") {
    const keys = Object.keys(question.criteria);
    return {
      type: "object",
      required: ["type", "choice", "probabilities", "confidence"],
      additionalProperties: false,
      properties: {
        type: { type: "string", const: "choice" },
        choice: { type: "string", enum: keys },
        probabilities: {
          type: "object",
          required: keys,
          additionalProperties: false,
          "x-probabilitySum": 1,
          "x-probabilityTolerance": LIMITS.probabilityTolerance,
          properties: Object.fromEntries(keys.map((key) => [key, { type: "number", minimum: 0, maximum: 1 }])),
        },
        confidence: { type: ["number", "null"], minimum: 0, maximum: 1 },
      },
    };
  }

  const scale = question.criteria.map((_item, index) => String(index));
  return {
    type: "object",
    required: ["type", "score", "legend", "probabilities", "confidence"],
    additionalProperties: false,
    properties: {
      type: { type: "string", const: "score" },
      score: { type: "number", minimum: 0, maximum: question.criteria.length - 1 },
      legend: {
        type: "object",
        required: scale,
        additionalProperties: false,
        properties: Object.fromEntries(scale.map((key, index) => [key, {
          type: "string",
          minLength: 1,
          maxLength: 1_000,
          ...(typeof question.criteria[index] === "string" ? { const: question.criteria[index] } : {}),
        }])),
      },
      probabilities: {
        type: "object",
        required: scale,
        additionalProperties: false,
        "x-probabilitySum": 1,
        "x-probabilityTolerance": LIMITS.probabilityTolerance,
        properties: Object.fromEntries(scale.map((key) => [key, { type: "number", minimum: 0, maximum: 1 }])),
      },
      confidence: { type: ["number", "null"], minimum: 0, maximum: 1 },
    },
  };
}

export function profileAnswersSchema(profile: AnyDecisionProfile): JsonSchema {
  return {
    type: "object",
    required: Object.keys(profile.questions),
    additionalProperties: false,
    properties: Object.fromEntries(Object.entries(profile.questions).map(([key, question]) => [key, questionAnswerSchema(question as DecisionQuestion)])),
  };
}

export function profileOutputSchema(profile: AnyDecisionProfile): JsonSchema {
  return profileAnswersSchema(profile);
}

export function canonicalAnswerSchema(): JsonSchema {
  return {
    oneOf: [
      {
        type: "object",
        required: ["type", "noul", "probabilities", "confidence"],
        additionalProperties: false,
        properties: {
          type: { type: "string", const: "noul" },
          noul: { type: "number", minimum: 0, maximum: 1 },
          probabilities: {
            type: "object", required: ["false", "true"], additionalProperties: false,
            "x-probabilitySum": 1, "x-probabilityTolerance": LIMITS.probabilityTolerance,
            properties: { false: { type: "number", minimum: 0, maximum: 1 }, true: { type: "number", minimum: 0, maximum: 1 } },
          },
          confidence: { type: "null", const: null },
        },
      },
      {
        type: "object",
        required: ["type", "choice", "probabilities", "confidence"],
        additionalProperties: false,
        properties: {
          type: { type: "string", const: "choice" },
          choice: { type: "string", minLength: 1 },
          probabilities: {
            type: "object", minProperties: 2, maxProperties: LIMITS.optionsPerQuestion,
            propertyNames: { pattern: "^[a-z][a-z0-9_]{0,63}$" },
            additionalProperties: { type: "number", minimum: 0, maximum: 1 },
            "x-probabilitySum": 1, "x-probabilityTolerance": LIMITS.probabilityTolerance,
          },
          confidence: { type: ["number", "null"], minimum: 0, maximum: 1 },
        },
      },
      {
        type: "object",
        required: ["type", "score", "legend", "probabilities", "confidence"],
        additionalProperties: false,
        properties: {
          type: { type: "string", const: "score" },
          score: { type: "number", minimum: 0, maximum: LIMITS.optionsPerQuestion - 1 },
          legend: {
            type: "object", minProperties: 2, maxProperties: LIMITS.optionsPerQuestion,
            propertyNames: { pattern: "^(?:[0-9]|1[01])$" },
            additionalProperties: { type: "string", minLength: 1, maxLength: 1_000 },
          },
          probabilities: {
            type: "object", minProperties: 2, maxProperties: LIMITS.optionsPerQuestion,
            propertyNames: { pattern: "^(?:[0-9]|1[01])$" },
            additionalProperties: { type: "number", minimum: 0, maximum: 1 },
            "x-probabilitySum": 1, "x-probabilityTolerance": LIMITS.probabilityTolerance,
          },
          confidence: { type: ["number", "null"], minimum: 0, maximum: 1 },
        },
      },
    ],
  };
}

export function publicProfileInputSchema(profile: AnyDecisionProfile): JsonSchema {
  return profile.inputSchema;
}
