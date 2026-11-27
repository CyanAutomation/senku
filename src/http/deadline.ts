export function parseSenkuDeadlineMs(value: string | null): number | undefined | null {
  if (value === null) return undefined;
  if (!/^\d{13}$/.test(value)) return null;
  const deadlineMs = Number(value);
  return Number.isSafeInteger(deadlineMs) && deadlineMs > 0 ? deadlineMs : null;
}

export function remainingProviderBudgetMs(
  deadlineMs: number | undefined,
  configuredTimeoutMs: number,
  nowMs = Date.now(),
): number {
  if (deadlineMs === undefined) return configuredTimeoutMs;
  return Math.min(configuredTimeoutMs, deadlineMs - nowMs);
}
