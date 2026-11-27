const CORRELATION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/;

export function isValidCorrelationId(value: string): boolean {
  return CORRELATION_ID_PATTERN.test(value);
}

/** Returns null only when a caller supplied an invalid value. */
export function correlationIdFromHeader(value: string | null, fallback: string): string | null {
  if (value === null) return fallback;
  return isValidCorrelationId(value) ? value : null;
}
