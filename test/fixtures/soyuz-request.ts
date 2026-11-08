export const soyuzRequest = {
  schemaVersion: "1",
  state: "Run status: failed. Exit code: 1. Changed files: 2. Recorded summary: Tests stopped after a temporary timeout.",
  questions: {
    likely_transient: {
      type: "noul",
      instructions: "Is the recorded failure likely transient?",
      criteria: {
        true: "A temporary network or service failure is evident.",
        false: "The evidence does not support a transient cause.",
      },
    },
    follow_up: {
      type: "choice",
      instructions: "Which follow-up is most appropriate?",
      criteria: {
        inspect_logs: "Review the retained validation logs.",
        review_changes: "Review the changed files.",
        retry_check: "Retry the same validation check once.",
      },
    },
    outcome_quality: {
      type: "score",
      instructions: "How well is the recorded outcome supported by evidence?",
      criteria: ["poorly supported", "partly supported", "well supported"],
    },
  },
} as const;
