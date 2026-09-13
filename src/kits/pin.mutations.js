/**
 * Kit Builder — pin/unpin mutations (MongoDB only).
 * Touches only the pinned flag on questions/flashcards.
 * No BullMQ, no LLM, no regeneration.
 */

const Kit = require('../models/Kit');
const { persistKitMutation, withContentRevision } = require('./mutationPersist');
const { setPinned } = require('./contentState');

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function getCollection(kit, key, label) {
  const items = kit.results?.[key];
  if (!Array.isArray(items)) {
    throw httpError(409, `Kit has no ${label} to pin yet`);
  }
  return items;
}

function findItemIndex(items, id, label) {
  const index = items.findIndex((item) => item.id === id);
  if (index === -1) {
    throw httpError(404, `${label} not found`);
  }
  return index;
}

function buildPersistPayload(kit, key, items) {
  const update = {
    [`results.${key}`]: items,
  };

  if (kit.data && typeof kit.data === 'object') {
    update.data = {
      ...kit.data,
      [key]: items,
    };
  }

  return update;
}

async function persistPinnedCollection(kitId, key, update) {
  const updated = await persistKitMutation(kitId, update);
  return withContentRevision(updated, {
    [key]: updated.results?.[key] || [],
  });
}

async function setItemPinned(kitId, collectionKey, itemId, pinned, label) {
  const kit = await Kit.findById(kitId).lean();
  if (!kit) throw httpError(404, 'Kit not found');

  const items = getCollection(kit, collectionKey, label).map((item) => ({ ...item }));
  const index = findItemIndex(items, itemId, label);

  const before = items[index];
  const after = setPinned(before, pinned);

  // Pinning must not alter content fields — only pinned (and normalized state keys).
  items[index] = after;

  const update = buildPersistPayload(kit, collectionKey, items);
  const result = await persistPinnedCollection(kitId, collectionKey, update);
  return {
    ...result,
    item: after,
  };
}

async function pinQuestion(kitId, questionId) {
  return setItemPinned(kitId, 'questions', questionId, true, 'Question');
}

async function unpinQuestion(kitId, questionId) {
  return setItemPinned(kitId, 'questions', questionId, false, 'Question');
}

async function pinFlashcard(kitId, flashcardId) {
  return setItemPinned(kitId, 'flashcards', flashcardId, true, 'Flashcard');
}

async function unpinFlashcard(kitId, flashcardId) {
  return setItemPinned(kitId, 'flashcards', flashcardId, false, 'Flashcard');
}

module.exports = {
  pinQuestion,
  unpinQuestion,
  pinFlashcard,
  unpinFlashcard,
  httpError,
};
