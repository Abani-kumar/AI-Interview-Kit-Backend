const Kit = require('../models/Kit');

const TERMINAL_STATUSES = new Set(['ready', 'failed', 'stalled']);

async function waitForKit(kitId, { pollIntervalMs = 1500, timeoutMs = 12 * 60 * 1000 } = {}) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const kit = await Kit.findById(kitId)
      .select('status error data currentStage stages')
      .lean();

    if (!kit) {
      throw new Error(`Kit not found: ${kitId}`);
    }

    if (TERMINAL_STATUSES.has(kit.status)) {
      return kit;
    }

    await sleep(pollIntervalMs);
  }

  const timedOut = new Error(`Kit generation timed out after ${Math.round(timeoutMs / 1000)}s`);
  timedOut.code = 'TIMEOUT';
  throw timedOut;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

module.exports = { waitForKit, TERMINAL_STATUSES };
