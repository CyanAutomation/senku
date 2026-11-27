import type { ProfileOwner } from "../contracts/profiles";

export type ClientIdentity = "kaseki" | "soyuz" | "rusty_fossil";
export type ProfileId =
  | "run_operations_triage_v1"
  | "kaseki_output_review_v1"
  | "kaseki_output_review_v2"
  | "run_retry_review_v1"
  | "task_admission_v1"
  | "kaseki_goal_check_v1"
  | "kaseki_run_evaluation_v1"
  | "kaseki_context_routing_v1"
  | "validation_recovery_v1";

export const CLIENT_ACCESS = {
  kaseki: {
    tokenEnv: "SENKU_KASEKI_API_TOKEN",
    nextTokenEnv: "SENKU_KASEKI_API_TOKEN_NEXT",
    required: true,
    allowedProfiles: [
      "task_admission_v1", "kaseki_goal_check_v1", "kaseki_run_evaluation_v1",
      "kaseki_context_routing_v1", "validation_recovery_v1",
    ],
  },
  soyuz: {
    tokenEnv: "SENKU_SOYUZ_API_TOKEN",
    nextTokenEnv: "SENKU_SOYUZ_API_TOKEN_NEXT",
    required: true,
    allowedProfiles: [
      "run_operations_triage_v1", "kaseki_output_review_v1", "kaseki_output_review_v2", "run_retry_review_v1",
    ],
  },
  rusty_fossil: {
    tokenEnv: "SENKU_RUSTY_FOSSIL_API_TOKEN",
    nextTokenEnv: "SENKU_RUSTY_FOSSIL_API_TOKEN_NEXT",
    required: false,
    allowedProfiles: [
      "task_admission_v1", "kaseki_goal_check_v1", "kaseki_run_evaluation_v1",
      "kaseki_context_routing_v1", "validation_recovery_v1",
    ],
  },
} as const satisfies Record<ClientIdentity, {
  tokenEnv: string;
  nextTokenEnv: string;
  required: boolean;
  allowedProfiles: readonly ProfileId[];
}>;

const permissionsByProfile = {} as Record<ProfileId, ClientIdentity[]>;
for (const clientId of Object.keys(CLIENT_ACCESS) as ClientIdentity[]) {
  for (const profileId of CLIENT_ACCESS[clientId].allowedProfiles) {
    (permissionsByProfile[profileId] ??= []).push(clientId);
  }
}

export const PROFILE_CLIENT_PERMISSIONS = permissionsByProfile as Record<ProfileId, readonly ClientIdentity[]>;

export function allowedClientsForProfile(profileId: ProfileId): readonly ClientIdentity[] {
  return PROFILE_CLIENT_PERMISSIONS[profileId];
}

export function canEvaluateProfile(profileId: string, clientId: ClientIdentity): boolean {
  if (!Object.hasOwn(PROFILE_CLIENT_PERMISSIONS, profileId)) return false;
  return (PROFILE_CLIENT_PERMISSIONS[profileId as ProfileId] as readonly ClientIdentity[]).includes(clientId);
}

export function profileOwner(
  profileId: "run_operations_triage_v1" | "kaseki_output_review_v1" | "kaseki_output_review_v2" | "run_retry_review_v1",
): "soyuz";
export function profileOwner(profileId: "task_admission_v1" | "kaseki_goal_check_v1" | "kaseki_run_evaluation_v1" | "kaseki_context_routing_v1" | "validation_recovery_v1"): "kaseki";
export function profileOwner(profileId: ProfileId): ProfileOwner {
  return PROFILE_CLIENT_PERMISSIONS[profileId][0] === "soyuz" ? "soyuz" : "kaseki";
}
