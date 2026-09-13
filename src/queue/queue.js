const { Queue } = require('bullmq');
const { createRedisConnection } = require('./connection');
const { stageJobId, resolveNextPassNumber } = require('./jobId');

const kitQueue = new Queue('kit-pipeline', {
  connection: createRedisConnection(),
});

async function enqueueStage(kitId, stageName, jobOptions, passNumber = 0) {
  return kitQueue.add(
    stageName,
    { kitId, passNumber },
    {
      jobId: stageJobId(kitId, stageName, passNumber),
      ...jobOptions,
      removeOnComplete: 500,
      removeOnFail: 1000,
    }
  );
}

module.exports = { kitQueue, enqueueStage, stageJobId, resolveNextPassNumber };
