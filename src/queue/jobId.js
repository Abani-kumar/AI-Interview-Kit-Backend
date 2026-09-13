/**
 * BullMQ jobId helpers for the kit pipeline.
 * Kept free of Redis/Queue side effects so unit tests can import safely.
 */

function stageJobId(kitId, stageName, passNumber = 0) {
  return `${kitId}:${stageName}:${passNumber}`;
}

/**
 * Decide which passNumber the *next* stage job should use.
 * - Coverage loop back into generate-questions → bump
 * - Everything else → keep the current pass (critical for regeneration:
 *   Date.now() pass must flow to check-coverage/flashcards/schedule/finalize
 *   or BullMQ silently ignores duplicate `:0` jobIds from the initial run)
 */
function resolveNextPassNumber(explicitNext, passNumber = 0) {
  if (explicitNext === 'generate-questions') {
    return passNumber + 1;
  }
  return passNumber;
}

module.exports = { stageJobId, resolveNextPassNumber };
