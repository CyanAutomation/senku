import type { ProviderUsage } from "../contracts/decisions";

export type SafeLogRecord = Record<string, string | number | boolean | undefined | ProviderUsage>;
export type Logger = (record: SafeLogRecord) => void;

export const consoleLogger: Logger = (record) => {
  console.log(JSON.stringify(record));
};

export function safeLog(logger: Logger, record: SafeLogRecord): void {
  try {
    logger(record);
  } catch {
    // Operational logging must not affect a decision response.
  }
}
