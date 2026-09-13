// Runs once at server startup. Finds kits that are stuck in states
// that should be transient — 'queued' with no job in BullMQ (Mongo
// succeeded but Redis enqueue failed), or 'stalled' (stage advanced
// in Mongo but next-stage enqueue threw). Re-enqueues the right stage.
//
// This is the assessment-appropriate replacement for a full outbox pattern.

const Kit = require('../models/Kit');
const { enqueueStage } = require('./queue');
const { stageRegistry } = require('./stageRegistry');

const STUCK_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes without progress = stuck

async function reconcileStuckKits() {
  const cutoff = new Date(Date.now() - STUCK_THRESHOLD_MS);

  const stuckKits = await Kit.find({
    status: { $in: ['queued', 'stalled'] },
    updatedAt: { $lt: cutoff },
  });

  if (stuckKits.length === 0) return;

  console.log(`[reconciler] Found ${stuckKits.length} stuck kit(s), re-enqueueing...`);

  for (const kit of stuckKits) {
    try {
      const stageName = kit.currentStage;
      const { jobOptions } = stageRegistry[stageName];

      // Read the current coveragePass so the jobId is correct
      const passNumber = kit.results?.coveragePass ?? 0;

      await enqueueStage(kit._id, stageName, jobOptions, passNumber);

      await Kit.findByIdAndUpdate(kit._id, {
        status: 'queued',
        error: null,
      });

      console.log(`[reconciler] Re-enqueued kit ${kit._id} at stage ${stageName}`);
    } catch (err) {
      console.error(`[reconciler] Failed to recover kit ${kit._id}:`, err.message);
    }
  }
}

module.exports = { reconcileStuckKits };
