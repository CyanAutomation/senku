import type { ProfileOwner } from "../contracts/profiles";

export type ClientIdentity = "kaseki" | "soyuz";
export type ProfileId =
  | "run_operations_triage_v1"
  | "kaseki_output_review_v1"
  | "kaseki_output_review_v2"
  | "task_admission_v1"
  | "validation_recovery_v1";

export const CLIENT_PERMISSIONS = {
  kaseki: { genericDecisions: true },
  soyuz: { genericDecisions: false },
} as const satisfies Record<ClientIdentity, { genericDecisions: boolean }>;

export const PROFILE_CLIENT_PERMISSIONS = {
  run_operations_triage_v1: ["soyuz"],
  kaseki_output_review_v1: ["soyuz"],
  kaseki_output_review_v2: ["soyuz"],
  task_admission_v1: ["kaseki"],
  validation_recovery_v1: ["kaseki"],
} as const satisfies Record<ProfileId, readonly ClientIdentity[]>;

export function canUseGenericDecisions(clientId: ClientIdentity): boolean {
  return CLIENT_PERMISSIONS[clientId].genericDecisions;
}

export function allowedClientsForProfile(profileId: ProfileId): readonly ClientIdentity[] {
  return PROFILE_CLIENT_PERMISSIONS[profileId];
}

export function canEvaluateProfile(profileId: ProfileId, clientId: ClientIdentity): boolean {
  return (PROFILE_CLIENT_PERMISSIONS[profileId] as readonly ClientIdentity[]).includes(clientId);
}

export function profileOwner(
  profileId: "run_operations_triage_v1" | "kaseki_output_review_v1" | "kaseki_output_review_v2",
): "soyuz";
export function profileOwner(profileId: "task_admission_v1" | "validation_recovery_v1"): "kaseki";
export function profileOwner(profileId: ProfileId): ProfileOwner {
  return PROFILE_CLIENT_PERMISSIONS[profileId][0] === "soyuz" ? "soyuz" : "kaseki";
}
