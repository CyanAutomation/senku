import type { Environment } from "../contracts/decisions";
import type { ClientIdentity } from "./permissions";

export type AuthenticationResult =
  | { authenticated: true; clientId: ClientIdentity }
  | { authenticated: false; reason: "not_configured" | "invalid_credentials" };

const encoder = new TextEncoder();
const MAX_TOKEN_BYTES = 1_024;
const MIN_TOKEN_CHARACTERS = 32;

export function isMachineTokenConfigValid(token: string | undefined): token is string {
  return typeof token === "string"
    && token.length >= MIN_TOKEN_CHARACTERS
    && encoder.encode(token).byteLength <= MAX_TOKEN_BYTES
    && /^[\x21-\x7e]+$/.test(token);
}

async function digestToken(token: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(token)));
}

async function constantTimeTokenMatch(candidate: string, expected: string): Promise<boolean> {
  const [candidateDigest, expectedDigest] = await Promise.all([
    digestToken(candidate),
    digestToken(expected),
  ]);
  let mismatch = candidateDigest.length ^ expectedDigest.length;
  for (let index = 0; index < candidateDigest.length; index += 1) {
    mismatch |= candidateDigest[index] ^ expectedDigest[index];
  }
  return mismatch === 0;
}

export function areMachineTokenCredentialsDistinct(
  env: Environment,
): env is Environment & { SENKU_KASEKI_API_TOKEN: string; SENKU_SOYUZ_API_TOKEN: string } {
  const kaseki = env.SENKU_KASEKI_API_TOKEN;
  const soyuz = env.SENKU_SOYUZ_API_TOKEN;
  return isMachineTokenConfigValid(kaseki)
    && isMachineTokenConfigValid(soyuz)
    && kaseki !== soyuz;
}

export async function authenticateBearer(
  authorization: string | null,
  env: Environment,
): Promise<AuthenticationResult> {
  if (!areMachineTokenCredentialsDistinct(env)) {
    return { authenticated: false, reason: "not_configured" };
  }
  if (!authorization) return { authenticated: false, reason: "invalid_credentials" };

  const match = /^Bearer ([^\s]+)$/i.exec(authorization);
  if (!match || match[1].length < MIN_TOKEN_CHARACTERS
    || encoder.encode(match[1]).byteLength > MAX_TOKEN_BYTES) {
    return { authenticated: false, reason: "invalid_credentials" };
  }
  try {
    const matches = await Promise.all([
      constantTimeTokenMatch(match[1], env.SENKU_KASEKI_API_TOKEN).then((matches) => ({ clientId: "kaseki" as const, matches })),
      constantTimeTokenMatch(match[1], env.SENKU_SOYUZ_API_TOKEN).then((matches) => ({ clientId: "soyuz" as const, matches })),
    ]);
    const matched = matches.filter((item) => item.matches);
    return matched.length === 1
      ? { authenticated: true, clientId: matched[0].clientId }
      : { authenticated: false, reason: "invalid_credentials" };
  } catch {
    return { authenticated: false, reason: "invalid_credentials" };
  }
}
