---
name: decision-calibration-and-replay
description: Design or analyze offline replay evaluations that compare Senku profile probabilities with recorded outcomes and assess calibration across profile versions.
---

# Decision calibration and replay

Use this skill for the roadmap follow-on that evaluates profile outputs against replayable outcomes. Read [profile contracts](../../../docs/PROFILES.md), [Phase 2C decisions and measurements](../../../docs/PHASE-2C-DECISIONS.md), and the relevant profile-specific decision notes before selecting metrics or interpreting results.

## Keep evaluation offline and reproducible

- The repository does not currently contain a replay dataset or calibration harness. Do not invent one or its outcome labels. Define the dataset requirements and harness first, then request an approved dataset before making metric claims.
- Keep raw prompts, caller evidence, credentials, and personal data out of committed fixtures and reports. Use synthetic or approved sanitized examples, and record dataset provenance and version.
- Do not make live provider calls for routine replay evaluation. Store and replay captured, authorized outputs or use deterministic fixtures.
- Profile results remain advisory. Calibration findings do not authorize execution, retries, admissions, threshold changes, or consumer policy changes.

## Evaluation procedure

1. Freeze the dataset version, profile ID and version, outcome-label definition, inclusion rules, and missing-data handling before comparing results.
2. Use metrics that match the output and label type. For probabilities, consider Brier score or log loss plus reliability by probability range; report sample counts for every range. Include decision accuracy or coverage only where the outcome and decision rule are defined.
3. Compare a candidate profile with a baseline on the same replay cases. Report per-profile results and relevant cohorts, sample size, uncertainty, and known selection bias. Do not infer calibration from a small or unrepresentative sample.
4. Keep analysis, profile changes, and consumer thresholds separate. Any proposed profile contract or threshold change needs the appropriate domain skill, versioning decision, and independent approval from the owning consumer.
5. Save the evaluation method and summary with enough metadata to reproduce it, while excluding sensitive evidence and secrets.

## Validate

Test metric calculations with small deterministic fixtures that cover edge cases such as missing labels, zero or one probabilities, and empty cohorts. Validate the replay harness without provider credentials or network access. Do not treat offline replay as proof of production behavior.

## Completion notes

State the dataset and profile versions, label definition, metrics, sample sizes, uncertainty and limitations, baseline comparison, and whether the work changed any profile or consumer policy.
