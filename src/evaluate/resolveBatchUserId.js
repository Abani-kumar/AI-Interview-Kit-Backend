const mongoose = require('mongoose');

// Stable default ObjectId for assessment runs — no real user session required.
const DEFAULT_BATCH_EVAL_USER_ID = '000000000000000000000e01';

function resolveBatchUserId() {
  const fromEnv = process.env.BATCH_EVAL_USER_ID;
  if (fromEnv && mongoose.Types.ObjectId.isValid(fromEnv)) {
    return new mongoose.Types.ObjectId(fromEnv);
  }

  return new mongoose.Types.ObjectId(DEFAULT_BATCH_EVAL_USER_ID);
}

module.exports = { resolveBatchUserId, DEFAULT_BATCH_EVAL_USER_ID };
