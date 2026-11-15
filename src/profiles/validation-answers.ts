import type { DecisionAnswer, DecisionQuestion } from "../contracts/decisions";
import type { AnswersFor, ProfileQuestions } from "../contracts/profiles";
import { ProfileEngineError } from "../contracts/profiles";
import { isPlainRecord } from "../contracts/records";

function answerMatchesQuestion(answer: unknown, question: DecisionQuestion): boolean {
  if (!answer || typeof answer !== "object" || (answer as DecisionAnswer).type !== question.type) return false;
  if (question.type === "choice") {
    const choice = (answer as DecisionAnswer & { type: "choice" }).choice;
    return typeof choice === "string" && Object.hasOwn(question.criteria, choice);
  }
  if (question.type === "score") {
    const score = (answer as DecisionAnswer & { type: "score" }).score;
    return typeof score === "number" && Number.isFinite(score) && score >= 0 && score <= question.criteria.length - 1;
  }
  return true;
}

export function validateAnswersForQuestions<const Questions extends ProfileQuestions>(
  value: unknown,
  questions: Questions,
): AnswersFor<Questions> {
  if (!isPlainRecord(value)) throw new ProfileEngineError("INVALID_PROFILE_OUTPUT");
  const expectedKeys = Object.keys(questions);
  const answerKeys = Object.keys(value);
  if (expectedKeys.length !== answerKeys.length
    || !expectedKeys.every((key) => Object.hasOwn(value, key))) {
    throw new ProfileEngineError("INVALID_PROFILE_OUTPUT");
  }
  for (const key of expectedKeys) {
    if (!answerMatchesQuestion(value[key], questions[key] as DecisionQuestion)) {
      throw new ProfileEngineError("INVALID_PROFILE_OUTPUT");
    }
  }
  return value as AnswersFor<Questions>;
}
