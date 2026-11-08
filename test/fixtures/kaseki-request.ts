export const kasekiRequest = {
  schemaVersion: "1",
  state: {
    task: "Run the focused tests and classify a temporary network timeout.",
    run: {
      command: "npm test -- src/retry.test.ts",
      exitCode: 1,
      failureSummary: "Temporary network timeout while fetching a test fixture.",
    },
    goal: {
      success_criteria: [
        "Keep the existing retry policy unchanged.",
        "Add a focused test for retryable network failures.",
      ],
    },
  },
  questions: {
    failure_cause: {
      type: "choice",
      instructions: "Classify the likely cause of the retained test failure.",
      criteria: {
        transient: "Temporary environment or network issue.",
        code_defect: "Application code defect.",
        unknown: null,
      },
    },
    safe_to_retry: {
      type: "noul",
      instructions: "Is this failure likely to be transient?",
    },
    completion_score: {
      type: "score",
      instructions: "How completely did the run satisfy its objective?",
      criteria: ["not complete", "partially complete", "complete"],
    },
  },
} as const;
