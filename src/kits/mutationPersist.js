/**
 * Shared MongoDB persist helper for Kit Builder mutations.
 * Bumps contentRevision on every user edit for optimistic concurrency.
 */

const Kit = require('../models/Kit');

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

async function persistKitMutation(kitId, update) {
  const updated = await Kit.findByIdAndUpdate(
    kitId,
    { $set: update, $inc: { contentRevision: 1 } },
    { new: true }
  ).lean();

  if (!updated) {
    throw httpError(404, 'Kit not found');
  }

  return updated;
}

/** Attach bumped contentRevision to every builder mutation response. */
function withContentRevision(updated, payload) {
  return {
    ...payload,
    contentRevision: updated?.contentRevision ?? 0,
  };
}

module.exports = { persistKitMutation, httpError, withContentRevision };
