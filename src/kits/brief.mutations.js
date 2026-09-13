/**
 * Kit Builder — company brief mutations (MongoDB only).
 * No BullMQ, no LLM, no research.
 * Does not modify requirements, questions, flashcards, or schedule.
 */

const Kit = require('../models/Kit');
const { persistKitMutation, withContentRevision, httpError } = require('./mutationPersist');
const { markEdited, normalizeContentState, stripContentState } = require('./contentState');

function asTrimmedString(value, fieldName) {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string') {
    throw httpError(400, `${fieldName} must be a string`);
  }
  return value.trim();
}

function asStringList(value, fieldName) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    throw httpError(400, `${fieldName} must be an array of strings`);
  }

  const items = [];
  for (const item of value) {
    if (typeof item !== 'string') {
      throw httpError(400, `${fieldName} must contain only strings`);
    }
    const trimmed = item.trim();
    if (trimmed) items.push(trimmed);
  }
  return items;
}

function validateSourceUrl(value) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw httpError(400, `Invalid source URL: "${value}"`);
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw httpError(400, `Source URL must use HTTP or HTTPS: "${value}"`);
  }

  return parsed.toString();
}

function asSourceList(value) {
  const urls = asStringList(value, 'sources');
  return urls.map(validateSourceUrl);
}

function toPublicBrief(brief) {
  const stripped = stripContentState(brief || {});
  return {
    summary: stripped.summary || '',
    what_they_do: stripped.what_they_do || '',
    interview_relevance: stripped.interview_relevance || '',
    hiring_signals: Array.isArray(stripped.hiring_signals) ? stripped.hiring_signals : [],
    interview_signals: Array.isArray(stripped.interview_signals) ? stripped.interview_signals : [],
    sources: Array.isArray(stripped.sources) ? stripped.sources : [],
  };
}

function applyPatch(current, patch) {
  const next = { ...current };

  if (patch.summary !== undefined) {
    next.summary = asTrimmedString(patch.summary, 'summary');
  }
  if (patch.what_they_do !== undefined) {
    next.what_they_do = asTrimmedString(patch.what_they_do, 'what_they_do');
  }
  if (patch.interview_relevance !== undefined) {
    next.interview_relevance = asTrimmedString(patch.interview_relevance, 'interview_relevance');
  }
  if (patch.hiring_signals !== undefined) {
    next.hiring_signals = asStringList(patch.hiring_signals, 'hiring_signals');
  }
  if (patch.interview_signals !== undefined) {
    next.interview_signals = asStringList(patch.interview_signals, 'interview_signals');
  }
  if (patch.sources !== undefined) {
    next.sources = asSourceList(patch.sources);
  }

  return next;
}

function buildPersistPayload(kit, companyBrief) {
  const update = {
    'results.companyBrief': companyBrief,
  };

  if (kit.data && typeof kit.data === 'object') {
    update.data = {
      ...kit.data,
      company_brief: toPublicBrief(companyBrief),
    };
  }

  return update;
}

async function updateCompanyBrief(kitId, patch = {}) {
  const kit = await Kit.findById(kitId).lean();
  if (!kit) throw httpError(404, 'Kit not found');

  const existing = kit.results?.companyBrief;
  if (!existing || typeof existing !== 'object') {
    throw httpError(409, 'Kit has no company brief to edit yet');
  }

  const current = { ...existing, ...normalizeContentState(existing) };
  const next = markEdited(applyPatch(current, patch));
  const update = buildPersistPayload(kit, next);
  const updated = await persistKitMutation(kitId, update);

  return withContentRevision(updated, {
    company_brief: toPublicBrief(updated.results?.companyBrief || next),
  });
}

module.exports = {
  updateCompanyBrief,
  toPublicBrief,
  httpError,
};
