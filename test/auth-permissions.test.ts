import { describe, expect, it } from "vitest";
import { areMachineTokenCredentialsDistinct, authenticateBearer, isMachineTokenConfigValid } from "../src/auth/bearer";
import {
  canEvaluateProfile,
  PROFILE_CLIENT_PERMISSIONS,
} from "../src/auth/permissions";
import { ProfileEngineError } from "../src/contracts/profiles";
import { DecisionProfileRegistry, profileRegistry } from "../src/decisions/profile-registry";
import { taskAdmissionProfile } from "../src/profiles/kaseki/task-admission";

const validToken = "senku-test-machine-token-0123456789abcdef";
const validSoyuzToken = "senku-soyuz-machine-token-0123456789abcdef";

describe("machine bearer configuration", () => {
  it("requires a non-empty printable token with at least 32 characters and bounded bytes", () => {
    expect(isMachineTokenConfigValid(validToken)).toBe(true);
    for (const token of [undefined, "", "short", ` ${validToken}`, `${validToken} `, "x".repeat(1_025)]) {
      expect(isMachineTokenConfigValid(token)).toBe(false);
    }
  });

  it("authenticates only the exact strong token and rejects malformed headers", async () => {
    const env = { SENKU_KASEKI_API_TOKEN: validToken, SENKU_SOYUZ_API_TOKEN: validSoyuzToken };
    expect(await authenticateBearer(`Bearer ${validToken}`, env)).toEqual({ authenticated: true, clientId: "kaseki" });
    expect(await authenticateBearer(`Bearer ${validSoyuzToken}`, env)).toEqual({ authenticated: true, clientId: "soyuz" });
    for (const header of [null, "Basic abc", "Bearer", "Bearer short", `Bearer ${"x".repeat(40)}`, `Bearer ${validToken} extra`, `Bearer ${validToken} `]) {
      expect(await authenticateBearer(header, env)).toEqual({ authenticated: false, reason: "invalid_credentials" });
    }
    expect(await authenticateBearer(`Bearer ${validToken}`, { SENKU_KASEKI_API_TOKEN: `${validToken} `, SENKU_SOYUZ_API_TOKEN: validSoyuzToken }))
      .toEqual({ authenticated: false, reason: "not_configured" });
    expect(await authenticateBearer(`Bearer ${validToken}`, { SENKU_KASEKI_API_TOKEN: validToken }))
      .toEqual({ authenticated: false, reason: "not_configured" });
    expect(await authenticateBearer(`Bearer ${validToken}`, { SENKU_KASEKI_API_TOKEN: validToken, SENKU_SOYUZ_API_TOKEN: validToken }))
      .toEqual({ authenticated: false, reason: "not_configured" });
  });

  it("accepts current and next credentials during a distinct, per-identity rotation window", async () => {
    const rustyToken = "senku-rusty-fossil-machine-token-0123456789";
    const env = {
      SENKU_KASEKI_API_TOKEN: validToken,
      SENKU_KASEKI_API_TOKEN_NEXT: "senku-kaseki-next-machine-token-0123456789",
      SENKU_SOYUZ_API_TOKEN: validSoyuzToken,
      SENKU_RUSTY_FOSSIL_API_TOKEN: rustyToken,
    };
    expect(areMachineTokenCredentialsDistinct(env)).toBe(true);
    expect(await authenticateBearer(`Bearer ${validToken}`, env)).toEqual({ authenticated: true, clientId: "kaseki" });
    expect(await authenticateBearer(`Bearer ${env.SENKU_KASEKI_API_TOKEN_NEXT}`, env)).toEqual({ authenticated: true, clientId: "kaseki" });
    expect(await authenticateBearer(`Bearer ${rustyToken}`, env)).toEqual({ authenticated: true, clientId: "rusty_fossil" });
    expect(areMachineTokenCredentialsDistinct({
      ...env,
      SENKU_RUSTY_FOSSIL_API_TOKEN: env.SENKU_KASEKI_API_TOKEN_NEXT,
    })).toBe(false);
    expect(areMachineTokenCredentialsDistinct({
      ...env,
      SENKU_KASEKI_API_TOKEN_NEXT: "short",
    })).toBe(false);
  });
});

describe("client permissions and registry", () => {
  it("scopes every server-owned profile to its registered owner", () => {
    for (const id of ["run_operations_triage_v1", "kaseki_output_review_v1", "kaseki_output_review_v2"] as const) {
      expect(canEvaluateProfile(id, "soyuz")).toBe(true);
      expect(canEvaluateProfile(id, "kaseki")).toBe(false);
    }
    for (const id of ["task_admission_v1", "validation_recovery_v1"] as const) {
      expect(canEvaluateProfile(id, "kaseki")).toBe(true);
      expect(canEvaluateProfile(id, "soyuz")).toBe(false);
    }
    for (const id of ["task_admission_v1", "kaseki_goal_check_v1", "kaseki_run_evaluation_v1", "kaseki_context_routing_v1", "validation_recovery_v1"] as const) {
      expect(canEvaluateProfile(id, "rusty_fossil")).toBe(true);
    }
    expect(PROFILE_CLIENT_PERMISSIONS.task_admission_v1).toEqual(["kaseki", "rusty_fossil"]);
  });

  it("rejects unknown and duplicate profile registration", () => {
    try {
      profileRegistry.getProfile("not_a_profile");
      throw new Error("Expected unknown profile rejection.");
    } catch (error) {
      expect(error).toBeInstanceOf(ProfileEngineError);
      expect((error as ProfileEngineError).code).toBe("UNKNOWN_PROFILE");
    }

    try {
      new DecisionProfileRegistry([taskAdmissionProfile, taskAdmissionProfile]);
      throw new Error("Expected duplicate profile rejection.");
    } catch (error) {
      expect(error).toBeInstanceOf(ProfileEngineError);
      expect((error as ProfileEngineError).code).toBe("DUPLICATE_PROFILE");
    }

    try {
      new DecisionProfileRegistry([{ ...taskAdmissionProfile, owner: "soyuz" }]);
      throw new Error("Expected mismatched profile owner rejection.");
    } catch (error) {
      expect(error).toBeInstanceOf(ProfileEngineError);
      expect((error as ProfileEngineError).code).toBe("INVALID_PROFILE_CONFIGURATION");
    }
  });
});
