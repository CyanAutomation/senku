import type { Environment } from "../contracts/decisions";

export type AuthenticationResult =
  | { authenticated: true; clientId: "kaseki" }
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

export async function authenticateBearer(
  authorization: string | null,
  env: Environment,
): Promise<AuthenticationResult> {
  const expected = env.SENKU_KASEKI_API_TOKEN;
  if (!isMachineTokenConfigValid(expected)) {
    return { authenticated: false, reason: "not_configured" };
  }
  if (!authorization) return { authenticated: false, reason: "invalid_credentials" };

  const match = /^Bearer ([^\s]+)$/i.exec(authorization);
  if (!match || match[1].length < MIN_TOKEN_CHARACTERS
    || encoder.encode(match[1]).byteLength > MAX_TOKEN_BYTES) {
    return { authenticated: false, reason: "invalid_credentials" };
  }
  try {
    return await constantTimeTokenMatch(match[1], expected)
      ? { authenticated: true, clientId: "kaseki" }
      : { authenticated: false, reason: "invalid_credentials" };
  } catch {
    return { authenticated: false, reason: "invalid_credentials" };
  }
}
