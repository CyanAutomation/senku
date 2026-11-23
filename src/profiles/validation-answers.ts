import type { DecisionQuestion } from "../contracts/decisions";
import type { AnswersFor, ProfileQuestions } from "../contracts/profiles";
import { ProfileEngineError } from "../contracts/profiles";
import { isPlainRecord } from "../contracts/records";

function noulAnswerMatches(answer: Record<string, unknown>): boolean {
  const noul = answer.noul;
  return typeof noul === "number" && Number.isFinite(noul) && noul >= 0 && noul <= 1;
}

function choiceAnswerMatches(answer: Record<string, unknown>, question: Extract<DecisionQuestion, { type: "choice" }>): boolean {
  const choice = answer.choice;
  return typeof choice === "string" && Object.hasOwn(question.criteria, choice);
}

function scoreAnswerMatches(answer: Record<string, unknown>, question: Extract<DecisionQuestion, { type: "score" }>): boolean {
  const score = answer.score;
  return typeof score === "number" && Number.isFinite(score) && score >= 0 && score <= question.criteria.length - 1;
}

function answerMatchesQuestion(answer: unknown, question: DecisionQuestion): boolean {
  if (!answer || typeof answer !== "object" || Array.isArray(answer)) return false;
  const answerRecord = answer as Record<string, unknown>;
  if (answerRecord.type !== question.type) return false;

  switch (question.type) {
    case "noul": return noulAnswerMatches(answerRecord);
    case "choice": return choiceAnswerMatches(answerRecord, question);
    case "score": return scoreAnswerMatches(answerRecord, question);
  }
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
