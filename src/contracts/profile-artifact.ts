import { allowedClientsForProfile, type ProfileId } from "../auth/permissions";
import { getPublicProfileContract, profileAnswersSchema } from "../api/profile-contracts";
import { profileRegistry } from "../decisions/profile-registry";
import type { AnyDecisionProfile } from "./profiles";

export const PROFILE_CONTRACT_COMPATIBILITY_POLICY =
  "Response envelope fields may be added. Required fields, meanings, and answer contracts may change only under a new schemaVersion.";

const DYNAMIC_PROFILE_SAMPLES: Record<string, Record<string, Record<string, unknown>>> = {
  kaseki_goal_check_v1: {
    with_applicability: {
      state: { validation: "passed" },
      criteria: [{ id: "criterion_1", criterion: "The sample requirement is met.", appliesWhen: "The requirement applies." }],
    },
  },
  kaseki_run_evaluation_v1: {
    with_failure_diagnosis: { state: { validation: "passed" }, includeFailureDiagnosis: true },
  },
  kaseki_context_routing_v1: {
    tool_output: {
      mode: "tool_output",
      evidence: {
        phase: "coding", toolName: "read_file", resultKind: "command_output", isError: false,
        characters: 1, bytes: 1, approximateTokens: 1, lineCount: 1,
        consecutiveDuplicateLineRatio: 0, hasReadRange: false,
      },
    },
    semantic_context: {
      mode: "semantic_context",
      evidence: {
        phase: "coding", toolName: "read_file", resultKind: "command_output", isError: false,
        characters: 1, bytes: 1, approximateTokens: 1, lineCount: 1,
        consecutiveDuplicateLineRatio: 0, hasReadRange: false, goalSummary: "",
      },
    },
    phase_transfer: {
      mode: "phase_transfer",
      evidence: {
        phase_from: "planning", phase_to: "coding", goal_summary: "",
        candidates: [
          { id: "file_0", kind: "inspected_file", text: "sample" },
          { id: "observation_0", kind: "observation", text: "sample" },
          { id: "plan_0", kind: "plan", text: "sample" },
          { id: "test_0", kind: "test_impact", text: "sample" },
        ],
      },
    },
  },
};

function outputVariants(profile: AnyDecisionProfile): Record<string, unknown> | undefined {
  const samples = DYNAMIC_PROFILE_SAMPLES[profile.id];
  if (!samples) return undefined;
  return Object.fromEntries(Object.entries(samples).map(([variant, input]) => {
    const validatedInput = profile.validateInput(input);
    const questions = profile.buildDecision(validatedInput).questions;
    const fixedQuestionsProfile = { ...profile, dynamicQuestions: false, questions } as AnyDecisionProfile;
    return [variant, profileAnswersSchema(fixedQuestionsProfile)];
  }));
}

export function createProfileContractArtifact() {
  return {
    schemaVersion: "1",
    compatibilityPolicy: PROFILE_CONTRACT_COMPATIBILITY_POLICY,
    profiles: profileRegistry.listProfiles()
      .map(({ id }) => {
        const contract = getPublicProfileContract(id);
        const artifact = {
          schemaVersion: contract.schemaVersion,
          id: contract.id,
          version: contract.version,
          name: contract.name,
          description: contract.description,
          owner: contract.owner,
          questionCount: contract.questionCount,
          dynamicQuestions: contract.dynamicQuestions,
          maxEvidenceBytes: contract.maxEvidenceBytes,
          operations: contract.operations,
          outputSchema: contract.outputSchema,
          limits: contract.limits,
          evaluationEndpoint: contract.evaluationEndpoint,
          allowedClients: [...allowedClientsForProfile(id as ProfileId)].sort(),
        };
        const variants = outputVariants(profileRegistry.getProfile(id));
        return variants ? { ...artifact, outputVariants: variants } : artifact;
      })
      .sort((left, right) => left.id.localeCompare(right.id)),
  };
}
