// Stage handler — deterministic coverage check.
// Returns { next: 'generate-questions' | 'generate-flashcards' }
// so the generic worker knows which stage to enqueue.
//
// This is the one stage in the pipeline where "next" is dynamic —
// everything else is static in the registry. The worker reads the
// return value and passes it to enqueueNextStage as explicitNext.
//
// Failure modes:
//   Invalid requirement refs in questions → throw (structural bug, retry)
//   Max passes reached with uncovered musts → throw (honest failure, not silent skip)
//   All musts covered → persist result, return { next: 'generate-flashcards' }
//   Uncovered musts + passes remaining → persist gap, reset generate-questions,
//     return { next: 'generate-questions' }

const Kit = require('../../models/Kit');
const { assertRegenerationBaseline, reloadKitForConcurrencyCheck } = require('../regenerationContext');
const {
  findInvalidRequirementRefs,
  countQuestionsByRequirement,
  computeUncoveredMustHaves,
} = require('./checkCoverage/coverageCalculator');
const { MAX_COVERAGE_PASSES } = require('../../config/coverageConfig');

async function checkCoverage(kitId) {
  const kit = await Kit.findById(kitId).lean();

  assertRegenerationBaseline(kit);

  const requirements = kit.results?.requirements?.items || [];
  const questions = kit.results?.questions || [];
  const currentPass = kit.results?.coveragePass ?? 0;

  const knownRequirementIds = new Set(requirements.map((r) => r.id));

  // --- Structural validation ---
  // Every requirement_id in every question must exist in the requirements set.
  // This should have been caught by generate-questions' validator, but we
  // re-check here because coverage math depends on this invariant being true.
  const invalidRefs = findInvalidRequirementRefs(questions, knownRequirementIds);
  if (invalidRefs.length > 0) {
    const detail = invalidRefs.map((r) => `q:${r.questionId} → ${r.invalidRef}`).join(', ');
    throw new Error(
      `check-coverage: questions contain invalid requirement_ids: ${detail}. ` +
        'This is a structural error from generate-questions.'
    );
  }

  // --- Coverage computation (deterministic) ---
  const questionCounts = countQuestionsByRequirement(questions);
  const uncoveredIds = computeUncoveredMustHaves(requirements, questionCounts);

  // --- All covered → advance to flashcards ---
  if (uncoveredIds.length === 0) {
    await reloadKitForConcurrencyCheck(kitId);
    await Kit.findByIdAndUpdate(kitId, {
      'results.coverage': {
        uncovered_requirement_ids: [],
        passes: currentPass + 1,
      },
    });
    return { next: 'generate-flashcards' };
  }

  // --- Uncovered requirements remain ---

  // Max passes reached → fail honestly rather than silently producing
  // an incomplete kit. An honest failure is better than a kit that
  // claims coverage it doesn't have.
  if (currentPass >= MAX_COVERAGE_PASSES) {
    const uncoveredTexts = requirements
      .filter((r) => uncoveredIds.includes(r.id))
      .map((r) => `${r.id}: "${r.text}"`)
      .join(', ');

    // Persist what we know before failing so the error is visible in the kit
    await reloadKitForConcurrencyCheck(kitId);
    await Kit.findByIdAndUpdate(kitId, {
      'results.coverage': {
        uncovered_requirement_ids: uncoveredIds,
        passes: currentPass + 1,
      },
    });

    throw new Error(
      `Coverage check exhausted ${MAX_COVERAGE_PASSES} pass(es). ` +
        `The following must-have requirements remain uncovered: ${uncoveredTexts}`
    );
  }

  // --- Passes remaining → loop back to generate-questions ---
  await reloadKitForConcurrencyCheck(kitId);
  await Kit.findByIdAndUpdate(kitId, {
    'results.coverage': {
      uncovered_requirement_ids: uncoveredIds,
      passes: currentPass + 1,
    },
    // Increment domain-level pass counter (not BullMQ retry count)
    'results.coveragePass': currentPass + 1,
    // Reset generate-questions' stage status so the atomic pending→running
    // guard in worker.js allows it to claim the job again.
    'stages.generate-questions.status': 'pending',
  });

  return { next: 'generate-questions' };
}

module.exports = checkCoverage;
