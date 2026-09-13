/**
 * Kit Builder — flashcard mutations (MongoDB only).
 * No BullMQ, no LLM, no research.
 * Does not modify questions, requirements, or schedule.
 */

const Kit = require('../models/Kit');
const { persistKitMutation, withContentRevision } = require('./mutationPersist');
const { withUserState, markEdited, normalizeContentState } = require('./contentState');

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function getFlashcards(kit) {
  const flashcards = kit.results?.flashcards;
  if (!Array.isArray(flashcards)) {
    throw httpError(409, 'Kit has no flashcards to edit yet');
  }
  return flashcards;
}

function knownRequirementIds(kit) {
  const items = kit.results?.requirements?.items;
  return new Set(Array.isArray(items) ? items.map((r) => r.id) : []);
}

function nextFlashcardId(flashcards) {
  let max = 0;
  for (const card of flashcards) {
    const match = typeof card.id === 'string' ? /^f(\d+)$/.exec(card.id) : null;
    if (match) {
      max = Math.max(max, parseInt(match[1], 10));
    }
  }
  return `f${max + 1}`;
}

function validateSide(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw httpError(400, `Flashcard ${fieldName} must be a non-empty string`);
  }
  return value.trim();
}

function validateRequirementIds(requirementIds, knownIds) {
  if (requirementIds === undefined) return undefined;
  if (!Array.isArray(requirementIds)) {
    throw httpError(400, 'requirement_ids must be an array of strings');
  }
  for (const id of requirementIds) {
    if (typeof id !== 'string' || id.trim() === '') {
      throw httpError(400, 'requirement_ids must contain only non-empty strings');
    }
    if (!knownIds.has(id)) {
      throw httpError(400, `Unknown requirement id: "${id}"`);
    }
  }
  return [...new Set(requirementIds)];
}

function findFlashcardIndex(flashcards, flashcardId) {
  const index = flashcards.findIndex((c) => c.id === flashcardId);
  if (index === -1) {
    throw httpError(404, 'Flashcard not found');
  }
  return index;
}

function buildPersistPayload(kit, flashcards) {
  const update = {
    'results.flashcards': flashcards,
  };

  if (kit.data && typeof kit.data === 'object') {
    update.data = {
      ...kit.data,
      flashcards,
    };
  }

  return update;
}

async function persistFlashcardMutation(kitId, update) {
  const updated = await persistKitMutation(kitId, update);
  return withContentRevision(updated, {
    flashcards: updated.results?.flashcards || [],
  });
}

async function updateFlashcard(kitId, flashcardId, patch) {
  const kit = await Kit.findById(kitId).lean();
  if (!kit) throw httpError(404, 'Kit not found');

  const flashcards = getFlashcards(kit).map((c) => ({ ...c }));
  const index = findFlashcardIndex(flashcards, flashcardId);
  let current = flashcards[index];
  const knownIds = knownRequirementIds(kit);

  if (patch.id !== undefined && patch.id !== flashcardId) {
    throw httpError(400, 'Flashcard id cannot be changed');
  }

  let changed = false;

  if (patch.front !== undefined) {
    current.front = validateSide(patch.front, 'front');
    changed = true;
  }

  if (patch.back !== undefined) {
    current.back = validateSide(patch.back, 'back');
    changed = true;
  }

  if (patch.requirement_ids !== undefined) {
    current.requirement_ids = validateRequirementIds(patch.requirement_ids, knownIds);
    changed = true;
  }

  if (changed) {
    current = markEdited(current);
  } else {
    const state = normalizeContentState(current);
    current = { ...current, ...state };
  }

  flashcards[index] = current;

  const update = buildPersistPayload(kit, flashcards);
  return persistFlashcardMutation(kitId, update);
}

async function addFlashcard(kitId, body) {
  const kit = await Kit.findById(kitId).lean();
  if (!kit) throw httpError(404, 'Kit not found');

  if (!Array.isArray(kit.results?.flashcards)) {
    throw httpError(409, 'Kit has no flashcards to edit yet');
  }

  const flashcards = kit.results.flashcards.map((c) => ({ ...c }));
  const knownIds = knownRequirementIds(kit);

  const front = validateSide(body.front, 'front');
  const back = validateSide(body.back, 'back');
  const requirementIds = validateRequirementIds(body.requirement_ids ?? [], knownIds);

  const id = nextFlashcardId(flashcards);
  if (flashcards.some((c) => c.id === id)) {
    throw httpError(500, 'Failed to allocate a unique flashcard id');
  }

  const newCard = withUserState({
    id,
    front,
    back,
    requirement_ids: requirementIds,
  });

  let insertIndex = flashcards.length;
  if (body.index !== undefined) {
    if (!Number.isInteger(body.index) || body.index < 0 || body.index > flashcards.length) {
      throw httpError(400, `Invalid index. Must be an integer between 0 and ${flashcards.length}`);
    }
    insertIndex = body.index;
  }

  flashcards.splice(insertIndex, 0, newCard);

  const update = buildPersistPayload(kit, flashcards);
  const result = await persistFlashcardMutation(kitId, update);
  return { ...result, flashcard: newCard };
}

async function deleteFlashcard(kitId, flashcardId) {
  const kit = await Kit.findById(kitId).lean();
  if (!kit) throw httpError(404, 'Kit not found');

  const flashcards = getFlashcards(kit).map((c) => ({ ...c }));
  findFlashcardIndex(flashcards, flashcardId);

  const nextFlashcards = flashcards.filter((c) => c.id !== flashcardId);
  const update = buildPersistPayload(kit, nextFlashcards);
  return persistFlashcardMutation(kitId, update);
}

async function reorderFlashcards(kitId, orderedIds) {
  const kit = await Kit.findById(kitId).lean();
  if (!kit) throw httpError(404, 'Kit not found');

  const flashcards = getFlashcards(kit);
  if (!Array.isArray(orderedIds)) {
    throw httpError(400, 'orderedIds must be an array of flashcard ids');
  }
  if (orderedIds.length !== flashcards.length) {
    throw httpError(400, 'orderedIds must include every flashcard id exactly once');
  }

  const byId = new Map(flashcards.map((c) => [c.id, c]));
  const seen = new Set();
  const reordered = [];

  for (const id of orderedIds) {
    if (seen.has(id)) {
      throw httpError(400, `Duplicate flashcard id in orderedIds: "${id}"`);
    }
    seen.add(id);
    const item = byId.get(id);
    if (!item) {
      throw httpError(400, `Unknown flashcard id in orderedIds: "${id}"`);
    }
    reordered.push({ ...item });
  }

  const update = buildPersistPayload(kit, reordered);
  return persistFlashcardMutation(kitId, update);
}

module.exports = {
  updateFlashcard,
  addFlashcard,
  deleteFlashcard,
  reorderFlashcards,
  // exported for unit tests
  nextFlashcardId,
  httpError,
};
