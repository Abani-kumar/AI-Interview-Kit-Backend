/**
 * Kit Builder — explicit section regeneration.
 * Enqueues existing BullMQ stages; no separate queue system.
 */

const Kit = require('../models/Kit');
const { enqueueStage } = require('../queue/queue');
const { stageRegistry } = require('../queue/stageRegistry');
const {
  REGENERATION_SECTIONS,
  STAGES_BY_SECTION,
  buildStageResets,
  validateSection,
  validateSectionPrerequisites,
  validateMissingRequirementIds,
  httpError,
} = require('./regenerationContext');

function regenerationConflictResponse(baseline, current) {
  const err = httpError(
    409,
    'Regeneration conflict: kit was modified since the client last loaded it',
    {
      code: 'REGENERATION_CONFLICT',
      baselineContentRevision: baseline,
      currentContentRevision: current,
    }
  );
  err.code = 'REGENERATION_CONFLICT';
  return err;
}

async function requestRegeneration(kitId, section, options = {}) {
  validateSection(section);

  const kit = await Kit.findById(kitId).lean();
  if (!kit) {
    throw httpError(404, 'Kit not found');
  }

  if (kit.status === 'generating' || kit.status === 'queued') {
    throw httpError(409, 'Kit is already generating');
  }

  if (kit.status !== 'ready') {
    throw httpError(409, `Kit cannot be regenerated while status is "${kit.status}"`);
  }

  validateSectionPrerequisites(kit, section);

  const expectedRevision = options.contentRevision ?? kit.contentRevision ?? 0;
  const currentRevision = kit.contentRevision ?? 0;

  if (options.contentRevision !== undefined && options.contentRevision !== currentRevision) {
    throw regenerationConflictResponse(expectedRevision, currentRevision);
  }

  const missingRequirementIds =
    section === REGENERATION_SECTIONS.QUESTIONS
      ? validateMissingRequirementIds(kit, options.missingRequirementIds)
      : null;

  const stagesToRun = STAGES_BY_SECTION[section];
  const targetStage = stagesToRun[0];
  const regenerationPass = Date.now();

  const stageResets = buildStageResets(stagesToRun);
  const regenerationMeta = {
    section,
    pass: regenerationPass,
    baselineContentRevision: currentRevision,
    missingRequirementIds,
    startedAt: new Date().toISOString(),
  };

  const update = {
    $set: {
      status: 'generating',
      currentStage: targetStage,
      data: null,
      'results.regeneration': regenerationMeta,
      ...stageResets,
    },
  };

  if (section === REGENERATION_SECTIONS.QUESTIONS) {
    update.$set['results.coveragePass'] = 0;
  }

  const claimed = await Kit.findOneAndUpdate(
    {
      _id: kitId,
      status: 'ready',
      contentRevision: currentRevision,
    },
    update,
    { new: true }
  ).lean();

  if (!claimed) {
    const latest = await Kit.findById(kitId).lean();
    if (!latest) {
      throw httpError(404, 'Kit not found');
    }
    if (latest.status === 'generating' || latest.status === 'queued') {
      throw httpError(409, 'Kit is already generating');
    }
    throw regenerationConflictResponse(
      expectedRevision,
      latest.contentRevision ?? 0
    );
  }

  const { jobOptions } = stageRegistry[targetStage];

  try {
    await enqueueStage(kitId, targetStage, jobOptions, regenerationPass);
  } catch (enqueueErr) {
    await Kit.findByIdAndUpdate(kitId, {
      status: 'stalled',
      error: `Regeneration enqueue failed: ${enqueueErr.message}`,
      'results.regeneration': null,
    });
    throw httpError(503, 'Could not queue regeneration. Kit marked stalled for recovery.');
  }

  return {
    kitId,
    status: 'generating',
    section,
    regenerationPass,
    progressUrl: `/api/kits/${kitId}/progress`,
    kitUrl: `/api/kits/${kitId}`,
  };
}

module.exports = {
  requestRegeneration,
  REGENERATION_SECTIONS,
};
