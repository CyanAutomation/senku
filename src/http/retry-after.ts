export const MAX_RETRY_AFTER_SECONDS = 86_400;

const HTTP_DATE_PATTERN = /^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun), \d{2} (?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{4} \d{2}:\d{2}:\d{2} GMT$/;

/** Parse a bounded delta-seconds or IMF-fixdate Retry-After value into seconds. */
export function parseRetryAfterSeconds(value: string | null, nowMs = Date.now()): number | undefined {
  const raw = value?.trim();
  if (!raw || raw.length > 128) return undefined;

  let seconds: number;
  if (/^\d+$/.test(raw)) {
    seconds = Number(raw);
  } else {
    if (!HTTP_DATE_PATTERN.test(raw)) return undefined;
    const timestamp = Date.parse(raw);
    if (!Number.isFinite(timestamp)) return undefined;
    seconds = Math.max(0, Math.ceil((timestamp - nowMs) / 1_000));
  }
  return isValidRetryAfterSeconds(seconds) ? seconds : undefined;
}

export function isValidRetryAfterSeconds(value: unknown): value is number {
  return typeof value === "number"
    && Number.isSafeInteger(value)
    && value >= 0
    && value <= MAX_RETRY_AFTER_SECONDS;
}
