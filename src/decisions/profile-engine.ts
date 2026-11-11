import { canEvaluateProfile, type ClientIdentity, type ProfileId } from "../auth/permissions";
import { LIMITS, SCHEMA_VERSION, type Environment } from "../contracts/decisions";
import { ProfileEngineError, type ProfileEvaluation } from "../contracts/profiles";
import { validateJsonSchema } from "../contracts/json-schema-validation";
import { validateDecisionRequest } from "../contracts/validation";
import { ProviderError, requestOpenRouterDecision, resolveProviderConfig } from "../providers/openrouter/decisions";
import { profileRegistry, type ProfileOutputFor, type RegisteredProfileId } from "./profile-registry";

export interface ProfileEvaluationContext {
  clientIdentity: ClientIdentity;
}

export interface ProfileEngineDependencies {
  env: Environment;
  fetchImpl?: typeof fetch;
  requestDecision?: typeof requestOpenRouterDecision;
}

function utf8Size(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function serializedSize(value: unknown): number {
  try {
    const serialized = JSON.stringify(value);
    if (typeof serialized !== "string") throw new Error("Value is not serializable.");
    return utf8Size(serialized);
  } catch {
    throw new ProfileEngineError("INVALID_PROFILE_INPUT");
  }
}

export async function evaluateProfile<Id extends RegisteredProfileId>(
  profileId: Id,
  input: unknown,
  context: ProfileEvaluationContext,
  dependencies: ProfileEngineDependencies,
): Promise<ProfileEvaluation<ProfileOutputFor<Id>>> {
  const profile = profileRegistry.getProfile(profileId);
  if (!canEvaluateProfile(profile.id as ProfileId, context.clientIdentity)) {
    throw new ProfileEngineError("FORBIDDEN_PROFILE");
  }

  if (!validateJsonSchema(input, profile.inputSchema)) {
    throw new ProfileEngineError("INVALID_PROFILE_INPUT");
  }
  const validatedInput = profile.validateInput(input);
  let decision: ReturnType<typeof profile.buildDecision>;
  try {
    decision = profile.buildDecision(validatedInput);
  } catch {
    throw new ProfileEngineError("INVALID_PROFILE_CONFIGURATION");
  }
  const request = {
    schemaVersion: SCHEMA_VERSION,
    state: decision.state,
    questions: decision.questions,
  };
  if (utf8Size(JSON.stringify(request)) > LIMITS.requestBytes) {
    throw new ProfileEngineError("PROFILE_INPUT_TOO_LARGE");
  }
  const validation = validateDecisionRequest(request);
  if (!validation.ok) throw new ProfileEngineError("INVALID_PROFILE_CONFIGURATION");
  const maxQuestionCount = profile.maxQuestionCount ?? LIMITS.questions;
  if (Object.keys(decision.questions).length > maxQuestionCount) {
    throw new ProfileEngineError("INVALID_PROFILE_CONFIGURATION");
  }

  const evidenceBytes = typeof decision.state === "string"
    ? utf8Size(decision.state)
    : serializedSize(decision.state);
  if (evidenceBytes > profile.maxEvidenceBytes
    || serializedSize(request) > LIMITS.requestBytes) {
    throw new ProfileEngineError("PROFILE_INPUT_TOO_LARGE");
  }

  const config = resolveProviderConfig(dependencies.env);
  if (!config.ok) throw new ProfileEngineError("NOT_CONFIGURED");

  const started = performance.now();
  let providerResult: Awaited<ReturnType<typeof requestOpenRouterDecision>>;
  try {
    providerResult = await (dependencies.requestDecision ?? requestOpenRouterDecision)(
      validation.value,
      config,
      dependencies.fetchImpl,
    );
  } catch (error) {
    if (error instanceof ProviderError) throw error;
    throw new ProviderError("PROVIDER_UNAVAILABLE", true);
  }

  const durationMs = Math.max(0, Math.round(performance.now() - started));
  const result = profile.validateOutput(providerResult.answers, validatedInput);
  return {
    profileId: profile.id,
    profileVersion: profile.version,
    owner: profile.owner,
    model: providerResult.model,
    answers: providerResult.answers,
    result: result as ProfileOutputFor<Id>,
    metadata: {
      profileId: profile.id,
      profileVersion: profile.version,
      clientIdentity: context.clientIdentity,
      resolvedModel: providerResult.model,
      questionCount: Object.keys(decision.questions).length,
      evidenceBytes,
      providerDurationMs: durationMs,
      attemptCount: 1,
      ...(providerResult.usage ? { usage: providerResult.usage } : {}),
    },
  };
}
