// Pure functions for coverage computation.
// All deterministic — no LLM, no network, no side effects.
// Exported separately so tests can verify the logic without any
// MongoDB or BullMQ involvement.

const { MIN_QUESTIONS_PER_MUST_REQUIREMENT } = require('../../../config/coverageConfig');

// Validates that every requirement_id referenced in any question
// actually exists in the known requirements set.
// Returns an array of invalid references found (empty = all valid).
// Called before coverage computation — an invalid reference is a
// structural invariant violation that must be caught here.
function findInvalidRequirementRefs(questions, knownRequirementIds) {
  const invalid = [];
  for (const q of questions) {
    for (const rid of q.requirement_ids || []) {
      if (!knownRequirementIds.has(rid)) {
        invalid.push({ questionId: q.id, invalidRef: rid });
      }
    }
  }
  return invalid;
}

// Counts how many questions reference each requirement ID.
// Returns Map<requirementId, count>.
function countQuestionsByRequirement(questions) {
  const counts = new Map();
  for (const q of questions) {
    for (const rid of q.requirement_ids || []) {
      counts.set(rid, (counts.get(rid) || 0) + 1);
    }
  }
  return counts;
}

// Computes which must-have requirements are insufficiently covered.
// A must-have requirement is covered when it has >= MIN_QUESTIONS_PER_MUST_REQUIREMENT
// questions referencing it. Nice requirements are not checked here —
// they never block the pipeline.
function computeUncoveredMustHaves(requirements, questionCounts) {
  return requirements
    .filter((r) => r.priority === 'must')
    .filter((r) => (questionCounts.get(r.id) || 0) < MIN_QUESTIONS_PER_MUST_REQUIREMENT)
    .map((r) => r.id);
}

module.exports = {
  findInvalidRequirementRefs,
  countQuestionsByRequirement,
  computeUncoveredMustHaves,
};
