export const SCHEMA_VERSION = "1" as const;

export const LIMITS = {
  requestBytes: 128 * 1024,
  providerResponseBytes: 64 * 1024,
  questions: 64,
  optionsPerQuestion: 12,
  contentDepth: 24,
  contentNodes: 8_192,
  probabilityTolerance: 0.03,
  instructionBytes: 16 * 1024,
} as const;

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export type JevContent = string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

export interface NoulQuestion {
  type: "noul";
  instructions: JevContent;
  criteria?: Partial<Record<"true" | "false", JevContent>>;
}

export interface ChoiceQuestion {
  type: "choice";
  instructions: JevContent;
  criteria: Record<string, JevContent | null>;
}

export interface ScoreQuestion {
  type: "score";
  instructions: JevContent;
  criteria: JevContent[];
}

export type DecisionQuestion = NoulQuestion | ChoiceQuestion | ScoreQuestion;

export interface DecisionRequest {
  schemaVersion: typeof SCHEMA_VERSION;
  state: string | JsonObject;
  questions: Record<string, DecisionQuestion>;
}

export interface NoulAnswer {
  type: "noul";
  noul: number;
  probabilities: { false: number; true: number };
  confidence: null;
}

export interface ChoiceAnswer {
  type: "choice";
  choice: string;
  probabilities: Record<string, number>;
  confidence: number | null;
}

export interface ScoreAnswer {
  type: "score";
  score: number;
  legend: Record<string, string>;
  probabilities: Record<string, number>;
  confidence: number | null;
}

export type DecisionAnswer = NoulAnswer | ChoiceAnswer | ScoreAnswer;

export interface ProviderUsage {
  input_tokens?: number;
  output_tokens?: number;
  total_tokens?: number;
  cost?: number;
}

export interface DecisionResponse {
  schemaVersion: typeof SCHEMA_VERSION;
  requestId: string;
  status: "completed";
  provider: "jev";
  model: string;
  answers: Record<string, DecisionAnswer>;
  usage?: ProviderUsage;
  durationMs: number;
  attemptCount: 1;
}

export type ErrorCode =
  | "INVALID_REQUEST"
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "PAYLOAD_TOO_LARGE"
  | "UNSUPPORTED_SCHEMA_VERSION"
  | "NOT_CONFIGURED"
  | "PROVIDER_TIMEOUT"
  | "PROVIDER_UNAVAILABLE"
  | "INVALID_PROVIDER_RESPONSE"
  | "NOT_FOUND"
  | "INTERNAL_ERROR";

export interface ErrorResponse {
  error: {
    code: ErrorCode;
    message: string;
    retryable: boolean;
    requestId: string;
  };
}

export interface Environment {
  OPENROUTER_API_KEY?: string;
  SENKU_KASEKI_API_TOKEN?: string;
  JEV_MODEL?: string;
  SENKU_PROVIDER_TIMEOUT_MS?: string;
}
