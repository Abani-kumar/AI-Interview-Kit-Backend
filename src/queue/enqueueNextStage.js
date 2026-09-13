const Kit = require('../models/Kit');
const { enqueueStage } = require('./queue');
const { stageRegistry } = require('./stageRegistry');

// FIX #2 (partial — assessment-grade recovery):
// The atomic findOneAndUpdate guards against double-enqueue from racing
// workers. If enqueueStage itself throws (Redis down), we catch it and
// write a 'stalled' marker to the kit so the startup reconciler can
// re-enqueue it. This is not a full outbox but gives durable recovery
// without a separate outbox collection.
//
// FIX #1: passNumber flows through so generate-questions gets a unique
// jobId on each coverage-loop pass.
async function enqueueNextStage(kitId, fromStage, explicitNext, passNumber = 0) {
  const nextStage = explicitNext !== undefined ? explicitNext : stageRegistry[fromStage].next;

  if (!nextStage) {
    return null; // terminal stage
  }

  const guarded = await Kit.findOneAndUpdate(
    { _id: kitId, currentStage: fromStage },
    { $set: { currentStage: nextStage } }
  );

  if (!guarded) {
    // Another worker already advanced this kit — don't double-enqueue
    return null;
  }

  const { jobOptions } = stageRegistry[nextStage];

  try {
    return await enqueueStage(kitId, nextStage, jobOptions, passNumber);
  } catch (err) {
    // Redis enqueue failed after Mongo already advanced currentStage.
    // Mark as stalled so the reconciler picks it up on next startup.
    await Kit.findByIdAndUpdate(kitId, {
      status: 'stalled',
      error: `Enqueue failed for stage ${nextStage}: ${err.message}`,
    });
    throw err;
  }
}

module.exports = { enqueueNextStage };
