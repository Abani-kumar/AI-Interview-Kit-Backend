/**
 * Kit Builder — requirement mutations (MongoDB only).
 * No BullMQ, no LLM, no research.
 */

const Kit = require('../models/Kit');
const { persistKitMutation, withContentRevision } = require('./mutationPersist');
const { VALID_KINDS, VALID_PRIORITIES } = require('./stages/extractRequirements/requirements.schema');
const {
  countQuestionsByRequirement,
  computeUncoveredMustHaves,
} = require('./stages/checkCoverage/coverageCalculator');

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function getItems(kit) {
  const items = kit.results?.requirements?.items;
  if (!Array.isArray(items)) {
    throw httpError(409, 'Kit has no requirements to edit yet');
  }
  return items;
}

function nextRequirementId(items) {
  let max = 0;
  for (const item of items) {
    const match = typeof item.id === 'string' ? /^r(\d+)$/.exec(item.id) : null;
    if (match) {
      max = Math.max(max, parseInt(match[1], 10));
    }
  }
  return `r${max + 1}`;
}

function validateText(text) {
  if (typeof text !== 'string' || text.trim() === '') {
    throw httpError(400, 'Requirement text must be a non-empty string');
  }
  return text.trim();
}

function validateKind(kind) {
  if (!VALID_KINDS.includes(kind)) {
    throw httpError(400, `Invalid kind. Must be one of: ${VALID_KINDS.join(', ')}`);
  }
  return kind;
}

function validatePriority(priority) {
  if (!VALID_PRIORITIES.includes(priority)) {
    throw httpError(400, `Invalid priority. Must be one of: ${VALID_PRIORITIES.join(', ')}`);
  }
  return priority;
}

function findRequirementIndex(items, requirementId) {
  const index = items.findIndex((r) => r.id === requirementId);
  if (index === -1) {
    throw httpError(404, 'Requirement not found');
  }
  return index;
}

/**
 * Deterministic coverage recompute for builder mutations.
 * Preserves existing pass count (pipeline concept); does not enqueue work.
 */
function recomputeCoverage(requirements, questions, existingCoverage) {
  const questionCounts = countQuestionsByRequirement(questions || []);
  const uncoveredIds = computeUncoveredMustHaves(requirements, questionCounts);
  return {
    uncovered_requirement_ids: uncoveredIds,
    passes: existingCoverage?.passes ?? 0,
  };
}

function detachRequirementRefs(items, requirementId) {
  return (items || []).map((item) => {
    if (!Array.isArray(item.requirement_ids) || !item.requirement_ids.includes(requirementId)) {
      return item;
    }
    return {
      ...item,
      requirement_ids: item.requirement_ids.filter((id) => id !== requirementId),
    };
  });
}

function buildPersistPayload(kit, { items, questions, flashcards, coverage }) {
  const requirements = {
    ...(kit.results?.requirements || {}),
    items,
  };

  const update = {
    'results.requirements': requirements,
    'results.coverage': coverage,
  };

  if (questions !== undefined) {
    update['results.questions'] = questions;
  }
  if (flashcards !== undefined) {
    update['results.flashcards'] = flashcards;
  }

  // Keep finalized Appendix A mirror in sync when present.
  if (kit.data && typeof kit.data === 'object') {
    update.data = {
      ...kit.data,
      role: {
        ...(kit.data.role || {}),
        requirements: items,
      },
      coverage,
    };
  }

  return update;
}

async function persistRequirementMutation(kitId, update) {
  const updated = await persistKitMutation(kitId, update);
  return withContentRevision(updated, {
    requirements: updated.results?.requirements?.items || [],
    coverage: updated.results?.coverage || {
      uncovered_requirement_ids: [],
      passes: 0,
    },
  });
}

async function updateRequirement(kitId, requirementId, patch) {
  const kit = await Kit.findById(kitId).lean();
  if (!kit) throw httpError(404, 'Kit not found');

  const items = getItems(kit).map((r) => ({ ...r }));
  const index = findRequirementIndex(items, requirementId);
  const current = items[index];

  if (patch.text !== undefined) {
    current.text = validateText(patch.text);
  }
  if (patch.kind !== undefined) {
    current.kind = validateKind(patch.kind);
  }
  if (patch.priority !== undefined) {
    current.priority = validatePriority(patch.priority);
  }

  // Reject unknown fields that could smuggle a new id
  if (patch.id !== undefined && patch.id !== requirementId) {
    throw httpError(400, 'Requirement id cannot be changed');
  }

  items[index] = current;

  const questions = kit.results?.questions || [];
  const coverage = recomputeCoverage(items, questions, kit.results?.coverage);
  const update = buildPersistPayload(kit, { items, coverage });
  return persistRequirementMutation(kitId, update);
}

async function addRequirement(kitId, body) {
  const kit = await Kit.findById(kitId).lean();
  if (!kit) throw httpError(404, 'Kit not found');

  // Allow adding once extraction has created the requirements container.
  // If missing entirely, create a minimal container.
  let requirementsDoc = kit.results?.requirements;
  if (!requirementsDoc || typeof requirementsDoc !== 'object') {
    throw httpError(409, 'Kit has no requirements to edit yet');
  }

  const items = Array.isArray(requirementsDoc.items)
    ? requirementsDoc.items.map((r) => ({ ...r }))
    : [];

  const text = validateText(body.text);
  const kind = validateKind(body.kind);
  const priority = validatePriority(body.priority);

  const id = nextRequirementId(items);
  if (items.some((r) => r.id === id)) {
    throw httpError(500, 'Failed to allocate a unique requirement id');
  }

  const newItem = { id, text, kind, priority };

  let insertIndex = items.length;
  if (body.index !== undefined) {
    if (!Number.isInteger(body.index) || body.index < 0 || body.index > items.length) {
      throw httpError(400, `Invalid index. Must be an integer between 0 and ${items.length}`);
    }
    insertIndex = body.index;
  }

  items.splice(insertIndex, 0, newItem);

  const questions = kit.results?.questions || [];
  const coverage = recomputeCoverage(items, questions, kit.results?.coverage);
  const update = buildPersistPayload(kit, { items, coverage });
  const result = await persistRequirementMutation(kitId, update);
  return { ...result, requirement: newItem };
}

async function deleteRequirement(kitId, requirementId) {
  const kit = await Kit.findById(kitId).lean();
  if (!kit) throw httpError(404, 'Kit not found');

  const items = getItems(kit).map((r) => ({ ...r }));
  findRequirementIndex(items, requirementId);

  const nextItems = items.filter((r) => r.id !== requirementId);
  const questions = detachRequirementRefs(kit.results?.questions || [], requirementId);
  const flashcards = detachRequirementRefs(kit.results?.flashcards || [], requirementId);
  const coverage = recomputeCoverage(nextItems, questions, kit.results?.coverage);

  const update = buildPersistPayload(kit, {
    items: nextItems,
    questions,
    flashcards,
    coverage,
  });
  return persistRequirementMutation(kitId, update);
}

async function reorderRequirements(kitId, orderedIds) {
  const kit = await Kit.findById(kitId).lean();
  if (!kit) throw httpError(404, 'Kit not found');

  const items = getItems(kit);
  if (!Array.isArray(orderedIds)) {
    throw httpError(400, 'orderedIds must be an array of requirement ids');
  }
  if (orderedIds.length !== items.length) {
    throw httpError(400, 'orderedIds must include every requirement id exactly once');
  }

  const byId = new Map(items.map((r) => [r.id, r]));
  const seen = new Set();
  const reordered = [];

  for (const id of orderedIds) {
    if (seen.has(id)) {
      throw httpError(400, `Duplicate requirement id in orderedIds: "${id}"`);
    }
    seen.add(id);
    const item = byId.get(id);
    if (!item) {
      throw httpError(400, `Unknown requirement id in orderedIds: "${id}"`);
    }
    reordered.push({ ...item });
  }

  // Reorder does not change coverage math (same set), but still refresh for a consistent response.
  const questions = kit.results?.questions || [];
  const coverage = recomputeCoverage(reordered, questions, kit.results?.coverage);
  const update = buildPersistPayload(kit, { items: reordered, coverage });
  return persistRequirementMutation(kitId, update);
}

module.exports = {
  updateRequirement,
  addRequirement,
  deleteRequirement,
  reorderRequirements,
  // exported for unit tests
  nextRequirementId,
  recomputeCoverage,
  detachRequirementRefs,
  httpError,
};
