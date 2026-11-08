import type {
  ChoiceAnswer,
  ChoiceQuestion,
  DecisionAnswer,
  DecisionQuestion,
  JsonObject,
  NoulAnswer,
  NoulQuestion,
  ProviderUsage,
  ScoreAnswer,
  ScoreQuestion,
} from "./decisions";
import type { ClientIdentity } from "../auth/permissions";

export type ProfileOwner = "kaseki" | "soyuz";
export type ProfileQuestions = Record<string, DecisionQuestion>;

export type AnswerForQuestion<Question extends DecisionQuestion> =
  Question extends NoulQuestion ? NoulAnswer
    : Question extends ChoiceQuestion ? ChoiceAnswer
      : Question extends ScoreQuestion ? ScoreAnswer
        : never;

export type AnswersFor<Questions extends ProfileQuestions> = {
  [Key in keyof Questions]: AnswerForQuestion<Questions[Key]>;
};

export interface ProfileMetadata {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly owner: ProfileOwner;
  readonly version: string;
  readonly allowedClients: readonly ClientIdentity[];
  readonly maxEvidenceBytes: number;
  readonly questionCount: number;
}

export interface DecisionProfile<
  Id extends string = string,
  Owner extends ProfileOwner = ProfileOwner,
  Input = unknown,
  Questions extends ProfileQuestions = ProfileQuestions,
  Output = unknown,
> {
  readonly id: Id;
  readonly name: string;
  readonly description: string;
  readonly owner: Owner;
  readonly version: string;
  readonly allowedClients: readonly ClientIdentity[];
  readonly maxEvidenceBytes: number;
  readonly questions: Questions;
  readonly validateInput: (value: unknown) => Input;
  readonly buildDecision: (input: Input) => {
    state: string | JsonObject;
    questions: Questions;
  };
  readonly validateOutput: (answers: Record<string, DecisionAnswer>) => Output;
}

export type AnyDecisionProfile = DecisionProfile<any, any, any, any, any>;

export interface ProfileEvaluationMetadata {
  profileId: string;
  profileVersion: string;
  clientIdentity: ClientIdentity;
  resolvedModel: string;
  questionCount: number;
  evidenceBytes: number;
  providerDurationMs: number;
  attemptCount: 1;
  usage?: ProviderUsage;
}

export interface ProfileEvaluation<Output = unknown> {
  profileId: string;
  profileVersion: string;
  owner: ProfileOwner;
  model: string;
  answers: Record<string, DecisionAnswer>;
  result: Output;
  metadata: ProfileEvaluationMetadata;
}

export type ProfileEngineErrorCode =
  | "UNKNOWN_PROFILE"
  | "DUPLICATE_PROFILE"
  | "FORBIDDEN_PROFILE"
  | "INVALID_PROFILE_INPUT"
  | "PROFILE_INPUT_TOO_LARGE"
  | "INVALID_PROFILE_OUTPUT"
  | "NOT_CONFIGURED";

export class ProfileEngineError extends Error {
  constructor(readonly code: ProfileEngineErrorCode) {
    super(code);
    this.name = "ProfileEngineError";
  }
}
