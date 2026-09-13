const Kit = require('../models/Kit');
const { enqueueStage } = require('../queue/queue');
const { stageRegistry } = require('../queue/stageRegistry');

const FIRST_STAGE = 'extract-requirements';

/**
 * Create a kit document and enqueue the first pipeline stage.
 * Shared by the HTTP API and the batch evaluator CLI.
 */
async function createAndEnqueueKit({ userId, jd, companyUrl, days }) {
  const kit = await Kit.create({
    userId,
    input: { jd, companyUrl, days },
    currentStage: FIRST_STAGE,
    status: 'queued',
  });

  try {
    await enqueueStage(kit._id, FIRST_STAGE, stageRegistry[FIRST_STAGE].jobOptions, 0);
  } catch (enqueueErr) {
    await Kit.findByIdAndUpdate(kit._id, {
      status: 'stalled',
      error: `Initial enqueue failed: ${enqueueErr.message}`,
    });
    const err = new Error(enqueueErr.message);
    err.code = 'ENQUEUE_FAILED';
    err.kitId = kit._id;
    throw err;
  }

  return kit;
}

module.exports = { createAndEnqueueKit, FIRST_STAGE };
