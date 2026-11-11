import type { DecisionQuestion } from "../../contracts/decisions";

export interface GoalCheckCriterion {
  id: string;
  criterion: string;
  appliesWhen?: string;
  sourceRequirement?: string;
  verificationSources?: string[];
}

export function buildGoalCheckQuestions(criteria: readonly GoalCheckCriterion[]): Record<string, DecisionQuestion> {
  return Object.fromEntries(criteria.flatMap(({ id, criterion, appliesWhen, sourceRequirement, verificationSources }) => [
    ...(appliesWhen ? [[`${id}_applicability`, {
      type: "choice" as const,
      instructions: `Does this condition apply based on the supplied repository and run evidence? Condition: ${appliesWhen}`,
      criteria: {
        applicable: "The condition applies, so assess the criterion.",
        not_applicable: "The condition does not apply; do not require this criterion.",
        unknown: "The evidence cannot establish whether the condition applies.",
      },
    } satisfies DecisionQuestion]] : []),
    [id, {
      type: "noul" as const,
      instructions: `Is this success criterion satisfied by the supplied repository and validation evidence? Criterion: ${criterion}${appliesWhen ? ` Applies when: ${appliesWhen}` : ""}${sourceRequirement ? ` Source requirement: ${sourceRequirement}` : ""}${verificationSources?.length ? ` Verify with: ${verificationSources.join(", ")}` : ""}`,
    } satisfies DecisionQuestion],
  ]));
}

export function buildRunEvaluationQuestions(includeFailureDiagnosis: boolean): Record<string, DecisionQuestion> {
  return {
    overall_assessment: { type: "choice", instructions: "What is the overall quality of this completed coding run?", criteria: { excellent: "Strong evidence and low review risk", good: "Acceptable evidence with limited review risk", mixed: "Material uncertainty or mixed signals", poor: "Major evidence or process problems" } },
    reviewer_confidence: { type: "choice", instructions: "How much confidence should a human PR reviewer place in this run evidence?", criteria: { high: "Validation and evidence strongly support the result", medium: "Evidence is mixed and merits closer PR review", low: "Evidence is weak and the PR needs careful review" } },
    task_completion_score: { type: "score", instructions: "How completely did the run satisfy its objective?", criteria: ["Largely unrealized", "Major requirements unmet", "Partially complete", "Nearly complete", "All requirements verified"] },
    ...(includeFailureDiagnosis ? {
      validation_failure_cause: { type: "choice" as const, instructions: "Based on the retained validation and failure evidence, what is the most likely cause? Treat this as a diagnostic hypothesis.", criteria: {
        test_failure: "A test assertion or behavioral check failed.",
        type_or_lint_failure: "Type checking, linting, or formatting failed.",
        build_failure: "Compilation, bundling, or build failed.",
        dependency_or_environment: "A dependency, service, platform, or environment problem caused the failure.",
        timeout_or_flaky: "The evidence points to a timeout or intermittent failure.",
        implementation_logic: "The code change appears to cause incorrect behavior.",
        unknown: "The available evidence does not support a more specific cause.",
      } },
      validation_recovery_action: { type: "choice" as const, instructions: "What is the safest next diagnostic action for the coding workflow? This is advisory and does not authorize skipping user-specified validation or pausing for human input.", criteria: {
        fix_implementation: "Correct the implementation, then rerun the requested checks.",
        repair_environment: "Repair the dependency or environment issue, then rerun the requested checks.",
        retry_validation_once: "Retry the same validation once to confirm a likely transient failure.",
        inspect_diagnostics: "Use the retained logs and failure artifact to narrow the cause before changing code.",
      } },
    } : {}),
  };
}
