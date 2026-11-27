import { canEvaluateProfile, type ClientIdentity, type ProfileId } from "../auth/permissions";
import { LIMITS, SCHEMA_VERSION, type DecisionRequest, type Environment } from "../contracts/decisions";
import { ProfileEngineError, type AnyDecisionProfile, type ProfileEvaluation } from "../contracts/profiles";
import { validateJsonSchema } from "../contracts/json-schema-validation";
import { validateDecisionRequest } from "../contracts/validation";
import { MAX_PROVIDER_TIMEOUT_MS, MIN_PROVIDER_TIMEOUT_MS, ProviderError, requestOpenRouterDecision, resolveProviderConfig, type ProviderConfig } from "../providers/openrouter/decisions";
import { remainingProviderBudgetMs } from "../http/deadline";
import type { BestEffortCircuitBreaker } from "../providers/openrouter/circuit-breaker";
import { profileRegistry, type ProfileOutputFor, type RegisteredProfileId } from "./profile-registry";

export interface ProfileEvaluationContext {
  clientIdentity: ClientIdentity;
}

export interface ProfileEngineDependencies {
  env: Environment;
  fetchImpl?: typeof fetch;
  requestDecision?: typeof requestOpenRouterDecision;
  deadlineAtMs?: number;
  providerCircuitBreaker?: BestEffortCircuitBreaker;
}

interface PreparedProfileRequest {
  request: DecisionRequest;
  evidenceBytes: number;
  questionCount: number;
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

function prepareProfileRequest(profile: AnyDecisionProfile, input: unknown): PreparedProfileRequest {
  let decision: ReturnType<AnyDecisionProfile["buildDecision"]>;
  try {
    decision = profile.buildDecision(input);
  } catch {
    throw new ProfileEngineError("INVALID_PROFILE_CONFIGURATION");
  }

  const request: DecisionRequest = {
    schemaVersion: SCHEMA_VERSION,
    state: decision.state,
    questions: decision.questions,
  };
  const requestBytes = serializedSize(request);
  if (requestBytes > LIMITS.requestBytes) {
    throw new ProfileEngineError("PROFILE_INPUT_TOO_LARGE");
  }

  const validation = validateDecisionRequest(request);
  if (!validation.ok) throw new ProfileEngineError("INVALID_PROFILE_CONFIGURATION");
  const questionCount = Object.keys(decision.questions).length;
  const maxQuestionCount = profile.maxQuestionCount ?? LIMITS.questions;
  if (questionCount > maxQuestionCount) throw new ProfileEngineError("INVALID_PROFILE_CONFIGURATION");

  const evidenceBytes = typeof decision.state === "string"
    ? utf8Size(decision.state)
    : serializedSize(decision.state);
  if (evidenceBytes > profile.maxEvidenceBytes) {
    throw new ProfileEngineError("PROFILE_INPUT_TOO_LARGE");
  }
  return { request: validation.value, evidenceBytes, questionCount };
}

async function requestProviderDecision(
  request: DecisionRequest,
  config: Extract<ProviderConfig, { ok: true }>,
  dependencies: ProfileEngineDependencies,
): Promise<Awaited<ReturnType<typeof requestOpenRouterDecision>>> {
  try {
    const operation = () => (dependencies.requestDecision ?? requestOpenRouterDecision)(
      request,
      config,
      dependencies.fetchImpl,
    );
    return await (dependencies.providerCircuitBreaker
      ? dependencies.providerCircuitBreaker.execute(operation)
      : operation());
  } catch (error) {
    if (error instanceof ProviderError) throw error;
    throw new ProviderError("PROVIDER_UNAVAILABLE", true);
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
  if (!validateJsonSchema(input, profile.inputSchema)) throw new ProfileEngineError("INVALID_PROFILE_INPUT");

  const validatedInput = profile.validateInput(input);
  const prepared = prepareProfileRequest(profile, validatedInput);
  const config = resolveProviderConfig(dependencies.env);
  if (!config.ok) throw new ProfileEngineError("NOT_CONFIGURED");
  const timeoutMs = remainingProviderBudgetMs(
    dependencies.deadlineAtMs,
    config.timeoutMs,
  );
  if (!Number.isFinite(timeoutMs) || timeoutMs < MIN_PROVIDER_TIMEOUT_MS) {
    throw new ProviderError("PROVIDER_TIMEOUT", true, { attemptCount: 0 });
  }
  const boundedConfig = {
    ...config,
    timeoutMs: Math.min(MAX_PROVIDER_TIMEOUT_MS, timeoutMs),
  };

  const started = performance.now();
  const providerResult = await requestProviderDecision(prepared.request, boundedConfig, dependencies);
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
      questionCount: prepared.questionCount,
      evidenceBytes: prepared.evidenceBytes,
      providerDurationMs: durationMs,
      attemptCount: providerResult.attemptCount,
      ...(providerResult.usage ? { usage: providerResult.usage } : {}),
    },
  };
}
