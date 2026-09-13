// Single source of truth for coverage-related constants.
// Both check-coverage (enforcement) and generate-questions (prompt
// instruction) read from here so they stay in sync automatically.
//
// MIN_QUESTIONS_PER_MUST_REQUIREMENT: how many distinct questions must
//   reference a must-have requirement ID before it is considered "covered".
//   Default: 1. Set higher (e.g. 2-3) for more thorough interview prep.
//   Applies to must-have requirements only — nice requirements always
//   need at least 1.
//
// MAX_COVERAGE_PASSES: how many times check-coverage may loop back to
//   generate-questions before giving up. A must-have requirement still
//   uncovered at this point causes the stage to fail the kit (not silently
//   continue) — an incomplete kit is worse than an honest failure.
//   Default: 2 (1 initial generation + up to 2 gap-fill passes).

const MIN_QUESTIONS_PER_MUST_REQUIREMENT = parseInt(
  process.env.MIN_QUESTIONS_PER_MUST_REQUIREMENT || '1',
  10
);

const MAX_COVERAGE_PASSES = parseInt(
  process.env.MAX_COVERAGE_PASSES || '2',
  10
);

module.exports = { MIN_QUESTIONS_PER_MUST_REQUIREMENT, MAX_COVERAGE_PASSES };
