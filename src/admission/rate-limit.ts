import type { RateLimitBinding } from "../contracts/decisions";

export type RateLimitResult = "allowed" | "limited" | "unavailable";

export async function checkRateLimit(binding: RateLimitBinding | undefined, key: string): Promise<RateLimitResult> {
  if (!binding) return "unavailable";
  try {
    const result = await binding.limit({ key });
    return result.success ? "allowed" : "limited";
  } catch {
    return "unavailable";
  }
}
