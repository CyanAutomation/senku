import type { ProfileMetadata } from "../contracts/profiles";
import { ProfileEngineError, type AnyDecisionProfile } from "../contracts/profiles";
import { allowedClientsForProfile, PROFILE_CLIENT_PERMISSIONS, type ClientIdentity, type ProfileId } from "../auth/permissions";
import { runOperationsTriageProfile } from "../profiles/soyuz/run-operations-triage";
import { kasekiOutputReviewV1Profile } from "../profiles/soyuz/output-review-v1";
import { kasekiOutputReviewV2Profile } from "../profiles/soyuz/output-review-v2";
import { taskAdmissionProfile } from "../profiles/kaseki/task-admission";
import { kasekiGoalCheckProfile } from "../profiles/kaseki/goal-check";
import { kasekiRunEvaluationProfile } from "../profiles/kaseki/run-evaluation";
import { kasekiContextRoutingProfile } from "../profiles/kaseki/context-routing";
import { validationRecoveryProfile } from "../profiles/kaseki/validation-recovery";

export const PROFILE_DEFINITIONS = {
  run_operations_triage_v1: runOperationsTriageProfile,
  kaseki_output_review_v1: kasekiOutputReviewV1Profile,
  kaseki_output_review_v2: kasekiOutputReviewV2Profile,
  task_admission_v1: taskAdmissionProfile,
  kaseki_goal_check_v1: kasekiGoalCheckProfile,
  kaseki_run_evaluation_v1: kasekiRunEvaluationProfile,
  kaseki_context_routing_v1: kasekiContextRoutingProfile,
  validation_recovery_v1: validationRecoveryProfile,
} as const satisfies Record<ProfileId, AnyDecisionProfile>;

export type RegisteredProfileId = keyof typeof PROFILE_DEFINITIONS;
export type ProfileInputFor<Id extends RegisteredProfileId> =
  ReturnType<(typeof PROFILE_DEFINITIONS)[Id]["validateInput"]>;
export type ProfileOutputFor<Id extends RegisteredProfileId> =
  ReturnType<(typeof PROFILE_DEFINITIONS)[Id]["validateOutput"]>;

function metadata(profile: AnyDecisionProfile): ProfileMetadata {
  return {
    id: profile.id,
    name: profile.name,
    description: profile.description,
    owner: profile.owner,
    version: profile.version,
    allowedClients: allowedClientsForProfile(profile.id as ProfileId),
    maxEvidenceBytes: profile.maxEvidenceBytes,
    questionCount: profile.maxQuestionCount ?? Object.keys(profile.questions).length,
    dynamicQuestions: profile.dynamicQuestions === true,
  };
}

export class DecisionProfileRegistry {
  private readonly profiles: ReadonlyMap<string, AnyDecisionProfile>;

  constructor(profiles: readonly AnyDecisionProfile[]) {
    const registered = new Map<string, AnyDecisionProfile>();
    for (const profile of profiles) {
      if (registered.has(profile.id)) throw new ProfileEngineError("DUPLICATE_PROFILE");
      const policy = Object.hasOwn(PROFILE_CLIENT_PERMISSIONS, profile.id)
        ? PROFILE_CLIENT_PERMISSIONS[profile.id as ProfileId]
        : undefined;
      if (!policy || !(policy as readonly ClientIdentity[]).includes(profile.owner)) {
        throw new ProfileEngineError("INVALID_PROFILE_CONFIGURATION");
      }
      registered.set(profile.id, profile);
    }
    this.profiles = registered;
  }

  getProfile(profileId: string): AnyDecisionProfile {
    const profile = this.profiles.get(profileId);
    if (!profile) throw new ProfileEngineError("UNKNOWN_PROFILE");
    return profile;
  }

  listProfiles(): ProfileMetadata[] {
    return [...this.profiles.values()].map(metadata);
  }
}

export const profileRegistry = new DecisionProfileRegistry(Object.values(PROFILE_DEFINITIONS));
