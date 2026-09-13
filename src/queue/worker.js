const { Worker } = require('bullmq');
const { createRedisConnection } = require('./connection');
const { stageRegistry } = require('./stageRegistry');
const { enqueueNextStage } = require('./enqueueNextStage');
const Kit = require('../models/Kit');
const { sendProgress } = require('./progress.sse');
const { runWithStageContext } = require('./stageContext');
const { createStageLogger } = require('../logging/stageLogger');

async function processor(job) {
  const stageName = job.name;
  const { kitId, passNumber = 0 } = job.data;
  const stage = stageRegistry[stageName];

  if (!stage) throw new Error(`Unknown stage: ${stageName}`);

  // FIX #8: atomic pending→running transition. If two workers race on the
  // same job (shouldn't happen with BullMQ but possible during retry
  // overlaps), only one wins this update — the other sees null and exits
  // instead of doing duplicate work.
  const claimed = await Kit.findOneAndUpdate(
    { _id: kitId, [`stages.${stageName}.status`]: 'pending' },
    {
      $set: {
        status: 'generating',
        [`stages.${stageName}.status`]: 'running',
      },
      $inc: { [`stages.${stageName}.attempts`]: 1 },
    }
  );

  if (!claimed) {
    // Stage is already running or done — another worker has it, exit cleanly
    return;
  }

  const startedAt = new Date();
  const logger = createStageLogger({ kitId, stageName, passNumber });

  await Kit.findByIdAndUpdate(kitId, {
    $set: {
      [`stages.${stageName}.startedAt`]: startedAt,
      [`stages.${stageName}.durationMs`]: null,
    },
  });

  sendProgress(kitId, { stage: stageName, status: 'running', passNumber, startedAt });

  logger.info('stage_start', `${logger.label} started`);

  const stageStartedMs = Date.now();

  try {
    // Handler returns { next } only for check-coverage; all others return undefined
    const result = await runWithStageContext({ kitId, stageName, passNumber, logger }, () =>
      stage.handler(kitId)
    );
    const explicitNext = result?.next;
    const durationMs = Date.now() - stageStartedMs;
    const completedAt = new Date();

    const { resolveNextPassNumber } = require('./jobId');
    const nextPassNumber = resolveNextPassNumber(explicitNext, passNumber);

    logger.info('stage_complete', `${logger.label} completed in ${durationMs}ms`, { durationMs });

    await Kit.findByIdAndUpdate(kitId, {
      $set: {
        [`stages.${stageName}.status`]: 'done',
        [`stages.${stageName}.completedAt`]: completedAt,
        [`stages.${stageName}.durationMs`]: durationMs,
        [`stages.${stageName}.logs`]: logger.getEntries(),
        [`stages.${stageName}.error`]: null,
      },
    });

    sendProgress(kitId, {
      stage: stageName,
      status: 'done',
      passNumber,
      durationMs,
      completedAt,
    });

    const enqueued = await enqueueNextStage(kitId, stageName, explicitNext, nextPassNumber);

    if (!enqueued) {
      // Terminal stage — pipeline complete
      await Kit.findByIdAndUpdate(kitId, { status: 'ready' });
      sendProgress(kitId, { stage: stageName, status: 'done', overall: 'ready', durationMs });
    }
  } catch (err) {
    const durationMs = Date.now() - stageStartedMs;
    logger.error('stage_error', err.message, { durationMs });

    if (err.code === 'REGENERATION_CONFLICT') {
      await Kit.findByIdAndUpdate(kitId, {
        status: 'ready',
        error: err.message,
        'results.regeneration': null,
        [`stages.${stageName}.status`]: 'failed',
        [`stages.${stageName}.error`]: err.message,
        [`stages.${stageName}.durationMs`]: durationMs,
        [`stages.${stageName}.logs`]: logger.getEntries(),
      });

      sendProgress(kitId, {
        stage: stageName,
        status: 'failed',
        passNumber,
        durationMs,
        error: err.message,
        code: 'REGENERATION_CONFLICT',
        details: err.details || null,
      });

      return;
    }

    // Reset to pending so BullMQ retries can reclaim this stage.
    await Kit.findByIdAndUpdate(kitId, {
      $set: {
        [`stages.${stageName}.status`]: 'pending',
        [`stages.${stageName}.durationMs`]: durationMs,
        [`stages.${stageName}.logs`]: logger.getEntries(),
        [`stages.${stageName}.error`]: err.message,
      },
    });

    sendProgress(kitId, {
      stage: stageName,
      status: 'retrying',
      passNumber,
      durationMs,
      error: err.message,
    });

    throw err;
  }
}

async function markStageFailed(kitId, stageName, err, { durationMs = null, logs = [] } = {}) {
  const failureLogs = [
    ...logs,
    {
      at: new Date().toISOString(),
      level: 'error',
      event: 'stage_failed',
      message: err.message,
    },
  ];

  await Kit.findByIdAndUpdate(kitId, {
    status: 'failed',
    error: err.message,
    [`stages.${stageName}.status`]: 'failed',
    [`stages.${stageName}.error`]: err.message,
    ...(durationMs !== null ? { [`stages.${stageName}.durationMs`]: durationMs } : {}),
    [`stages.${stageName}.logs`]: failureLogs,
  });
  sendProgress(kitId, {
    stage: stageName,
    status: 'failed',
    error: err.message,
    ...(durationMs !== null ? { durationMs } : {}),
  });
}

const worker = new Worker('kit-pipeline', processor, {
  connection: createRedisConnection(),
  concurrency: 3,
});

worker.on('ready', () => {
  console.log('[worker] BullMQ worker ready — listening on queue "kit-pipeline"');
});

worker.on('active', (job) => {
  console.log(
    `[worker] started ${job.name}:${job.data.passNumber ?? 0} for kit ${job.data.kitId}`
  );
});

let lastWorkerErrorAt = 0;
worker.on('error', (err) => {
  const now = Date.now();
  if (now - lastWorkerErrorAt < 5000) return;
  lastWorkerErrorAt = now;

  const detail = err?.message || err?.code || String(err);
  console.error('[worker] Redis connection error:', detail);
  console.error('[worker] Fix REDIS_URL or REDIS_HOST/REDIS_PASSWORD/REDIS_TLS in .env (Upstash needs TLS).');
});

worker.on('completed', async (job) => {
  const kit = await Kit.findById(job.data.kitId).lean();
  const stage = kit?.stages?.[job.name];
  const durationMs = stage?.durationMs;
  const timing = durationMs != null ? ` in ${durationMs}ms` : '';

  console.log(
    `[worker] ${job.name}:${job.data.passNumber ?? 0} done for kit ${job.data.kitId}${timing}`
  );
});

// Fires only after BullMQ exhausts all configured attempts — this is the
// dead-letter case. BullMQ owns retries; we only write the final failure here.
worker.on('failed', async (job, err) => {
  console.error(`[worker] ${job?.name} permanently failed for kit ${job?.data?.kitId}:`, err.message);
  if (job && job.attemptsMade >= (job.opts?.attempts ?? 1)) {
    await markStageFailed(job.data.kitId, job.name, err);
  }
});

module.exports = worker;
