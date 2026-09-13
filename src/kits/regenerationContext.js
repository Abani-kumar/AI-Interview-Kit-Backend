/**
 * Regeneration metadata and optimistic-concurrency helpers.
 */

const Kit = require('../models/Kit');

const STAGE_NAMES = [
  'extract-requirements',
  'research-company',
  'generate-brief',
  'generate-questions',
  'check-coverage',
  'generate-flashcards',
  'build-schedule',
  'validate-and-finalize',
];

const REGENERATION_SECTIONS = Object.freeze({
  BRIEF: 'brief',
  QUESTIONS: 'questions',
  FLASHCARDS: 'flashcards',
});

const STAGES_BY_SECTION = Object.freeze({
  [REGENERATION_SECTIONS.BRIEF]: ['generate-brief', 'validate-and-finalize'],
  [REGENERATION_SECTIONS.QUESTIONS]: [
    'generate-questions',
    'check-coverage',
    'generate-flashcards',
    'build-schedule',
    'validate-and-finalize',
  ],
  [REGENERATION_SECTIONS.FLASHCARDS]: ['generate-flashcards', 'validate-and-finalize'],
});

const TERMINAL_NEXT_BY_SECTION = Object.freeze({
  [REGENERATION_SECTIONS.BRIEF]: 'validate-and-finalize',
  [REGENERATION_SECTIONS.FLASHCARDS]: 'validate-and-finalize',
});

function httpError(status, message, details = null) {
  const err = new Error(message);
  err.status = status;
  if (details) err.details = details;
  return err;
}

function regenerationConflictError(baseline, current) {
  const err = httpError(
    409,
    'Regeneration conflict: kit was modified after regeneration started',
    {
      code: 'REGENERATION_CONFLICT',
      baselineContentRevision: baseline,
      currentContentRevision: current,
    }
  );
  err.code = 'REGENERATION_CONFLICT';
  return err;
}

function getRegeneration(kit) {
  const reg = kit?.results?.regeneration;
  if (!reg || typeof reg !== 'object') return null;
  return reg;
}

function isRegenerationActive(kit) {
  return Boolean(getRegeneration(kit)?.section);
}

function isRegenerationSection(kit, section) {
  return getRegeneration(kit)?.section === section;
}

function assertRegenerationBaseline(kit) {
  const reg = getRegeneration(kit);
  if (!reg) return;

  const baseline = reg.baselineContentRevision;
  if (baseline === undefined || baseline === null) return;

  const current = kit.contentRevision ?? 0;
  if (current !== baseline) {
    throw regenerationConflictError(baseline, current);
  }
}

function terminalNextForRegeneration(kit) {
  const section = getRegeneration(kit)?.section;
  return TERMINAL_NEXT_BY_SECTION[section] || null;
}

function buildStageResets(stagesToRun) {
  const reset = {};
  for (const stageName of STAGE_NAMES) {
    if (stagesToRun.includes(stageName)) {
      reset[`stages.${stageName}.status`] = 'pending';
      reset[`stages.${stageName}.error`] = null;
      reset[`stages.${stageName}.completedAt`] = null;
      reset[`stages.${stageName}.durationMs`] = null;
    }
  }
  return reset;
}

function validateSection(section) {
  if (!Object.values(REGENERATION_SECTIONS).includes(section)) {
    throw httpError(400, `Invalid regeneration section: "${section}"`);
  }
}

function validateSectionPrerequisites(kit, section) {
  const results = kit.results || {};

  if (section === REGENERATION_SECTIONS.BRIEF) {
    if (!results.companyBrief) {
      throw httpError(409, 'Kit has no company brief to regenerate yet');
    }
    return;
  }

  if (section === REGENERATION_SECTIONS.QUESTIONS) {
    if (!Array.isArray(results.questions) || results.questions.length === 0) {
      throw httpError(409, 'Kit has no questions to regenerate yet');
    }
    return;
  }

  if (section === REGENERATION_SECTIONS.FLASHCARDS) {
    if (!Array.isArray(results.flashcards)) {
      throw httpError(409, 'Kit has no flashcards to regenerate yet');
    }
  }
}

function validateMissingRequirementIds(kit, missingRequirementIds) {
  if (missingRequirementIds === undefined || missingRequirementIds === null) {
    return null;
  }

  if (!Array.isArray(missingRequirementIds)) {
    throw httpError(400, 'missingRequirementIds must be an array of strings');
  }

  const knownIds = new Set(
    (kit.results?.requirements?.items || []).map((r) => r.id)
  );

  const normalized = [];
  for (const id of missingRequirementIds) {
    if (typeof id !== 'string' || id.trim() === '') {
      throw httpError(400, 'missingRequirementIds must contain only non-empty strings');
    }
    if (!knownIds.has(id)) {
      throw httpError(400, `Unknown requirement id in missingRequirementIds: "${id}"`);
    }
    if (!normalized.includes(id)) {
      normalized.push(id);
    }
  }

  return normalized;
}

async function reloadKitForConcurrencyCheck(kitId) {
  const kit = await Kit.findById(kitId).lean();
  if (!kit) {
    throw httpError(404, 'Kit not found');
  }
  assertRegenerationBaseline(kit);
  return kit;
}

module.exports = {
  REGENERATION_SECTIONS,
  STAGES_BY_SECTION,
  TERMINAL_NEXT_BY_SECTION,
  getRegeneration,
  isRegenerationActive,
  isRegenerationSection,
  assertRegenerationBaseline,
  terminalNextForRegeneration,
  buildStageResets,
  validateSection,
  validateSectionPrerequisites,
  validateMissingRequirementIds,
  reloadKitForConcurrencyCheck,
  regenerationConflictError,
  httpError,
};
