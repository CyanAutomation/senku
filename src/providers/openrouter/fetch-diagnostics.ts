export type ProviderFetchFailureClass = "dns" | "connection" | "tls" | "network" | "timeout" | "unknown";

const FAILURE_CLASS_BY_CODE: ReadonlyMap<string, ProviderFetchFailureClass> = new Map([
  ["ENOTFOUND", "dns"],
  ["EAI_AGAIN", "dns"],
  ["EAI_FAIL", "dns"],
  ["EAI_NODATA", "dns"],
  ["ECONNREFUSED", "connection"],
  ["ECONNRESET", "connection"],
  ["EHOSTUNREACH", "connection"],
  ["ENETUNREACH", "connection"],
  ["EPIPE", "connection"],
  ["UND_ERR_CONNECT", "connection"],
  ["UND_ERR_SOCKET", "connection"],
  ["ETIMEDOUT", "timeout"],
  ["UND_ERR_CONNECT_TIMEOUT", "timeout"],
  ["UND_ERR_HEADERS_TIMEOUT", "timeout"],
  ["UND_ERR_BODY_TIMEOUT", "timeout"],
  ["ERR_TLS_CERT_ALTNAME_INVALID", "tls"],
  ["ERR_TLS_CERT_SIGNATURE_ALGORITHM_UNSUPPORTED", "tls"],
  ["CERT_HAS_EXPIRED", "tls"],
  ["DEPTH_ZERO_SELF_SIGNED_CERT", "tls"],
  ["UNABLE_TO_VERIFY_LEAF_SIGNATURE", "tls"],
  ["ERR_SSL_WRONG_VERSION_NUMBER", "tls"],
]);

/** Classifies fetch failures using a finite code allowlist; raw errors and codes are never returned. */
export function classifyProviderFetchFailure(error: unknown, aborted = false): ProviderFetchFailureClass {
  if (aborted) return "timeout";

  let current: unknown = error;
  for (let depth = 0; depth < 4 && current !== null && typeof current === "object"; depth += 1) {
    const code = safeStringProperty(current, "code");
    if (code) {
      const failureClass = FAILURE_CLASS_BY_CODE.get(code);
      if (failureClass) return failureClass;
    }

    const cause = safeProperty(current, "cause");
    if (cause === undefined || cause === current) break;
    current = cause;
  }

  try {
    return error instanceof TypeError ? "network" : "unknown";
  } catch {
    return "unknown";
  }
}

function safeStringProperty(value: object, key: string): string | undefined {
  try {
    const property = safeProperty(value, key);
    return typeof property === "string" ? property : undefined;
  } catch {
    return undefined;
  }
}

function safeProperty(value: object, key: string): unknown {
  try {
    return (value as Record<string, unknown>)[key];
  } catch {
    return undefined;
  }
}
