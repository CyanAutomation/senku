import type { ChoiceQuestion, DecisionQuestion, DecisionRequest, ScoreQuestion } from "../../src/contracts/decisions";

interface ProviderResponseOptions {
  invalid?: boolean;
  noul?: number;
  choiceConfidence?: number | null;
  score?: number;
  scoreProbabilityIndex?: number;
  usage?: Record<string, unknown>;
}

function choiceAnswer(question: ChoiceQuestion, options: ProviderResponseOptions) {
  const keys = Object.keys(question.criteria);
  return {
    type: "choice",
    choice: keys[0],
    probabilities: Object.fromEntries(keys.map((choice, index) => [choice, index === 0 ? 1 : 0])),
    confidence: options.choiceConfidence ?? null,
  };
}

function scoreAnswer(question: ScoreQuestion, options: ProviderResponseOptions) {
  const keys = question.criteria.map((_criterion, index) => String(index));
  return {
    type: "score",
    score: options.score ?? 0,
    legend: Object.fromEntries(question.criteria.map((criterion, index) => [
      String(index),
      typeof criterion === "string" ? criterion : JSON.stringify(criterion),
    ])),
    probabilities: Object.fromEntries(keys.map((score, index) => [
      score,
      index === (options.scoreProbabilityIndex ?? 0) ? 1 : 0,
    ])),
    confidence: null,
  };
}

function answerForQuestion(question: DecisionQuestion, options: ProviderResponseOptions) {
  switch (question.type) {
    case "noul":
      return { type: "noul", noul: options.noul ?? 0.75 };
    case "choice":
      return choiceAnswer(question, options);
    case "score":
      return scoreAnswer(question, options);
  }
}

export function providerResponse(request: DecisionRequest, options: ProviderResponseOptions = {}): Response {
  const answers = options.invalid
    ? {}
    : Object.fromEntries(Object.entries(request.questions ?? {}).map(([key, question]) => [key, answerForQuestion(question, options)]));

  return new Response(JSON.stringify({
    model: "typesafe/jev-1.14-20261014",
    answers,
    ...(options.usage ? { usage: options.usage } : {}),
  }), { headers: { "content-type": "application/json" } });
}
