import type { ProfileMetadata } from "../contracts/profiles";
import { ProfileEngineError, type AnyDecisionProfile } from "../contracts/profiles";
import type { ProfileId } from "../auth/permissions";
import { runOperationsTriageProfile } from "../profiles/soyuz/run-operations-triage";
import { kasekiOutputReviewV1Profile } from "../profiles/soyuz/output-review-v1";
import { kasekiOutputReviewV2Profile } from "../profiles/soyuz/output-review-v2";
import { taskAdmissionProfile } from "../profiles/kaseki/task-admission";
import { validationRecoveryProfile } from "../profiles/kaseki/validation-recovery";

export const PROFILE_DEFINITIONS = {
  run_operations_triage_v1: runOperationsTriageProfile,
  kaseki_output_review_v1: kasekiOutputReviewV1Profile,
  kaseki_output_review_v2: kasekiOutputReviewV2Profile,
  task_admission_v1: taskAdmissionProfile,
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
    allowedClients: profile.allowedClients,
    maxEvidenceBytes: profile.maxEvidenceBytes,
    questionCount: Object.keys(profile.questions).length,
  };
}

export class DecisionProfileRegistry {
  private readonly profiles: ReadonlyMap<string, AnyDecisionProfile>;

  constructor(profiles: readonly AnyDecisionProfile[]) {
    const registered = new Map<string, AnyDecisionProfile>();
    for (const profile of profiles) {
      if (registered.has(profile.id)) throw new ProfileEngineError("DUPLICATE_PROFILE");
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
