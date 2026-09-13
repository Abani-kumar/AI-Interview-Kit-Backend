const {
  updateFlashcard,
  addFlashcard,
  deleteFlashcard,
  reorderFlashcards,
} = require('./flashcards.mutations');

function handleMutationError(err, res) {
  if (err.status) {
    return res.status(err.status).json({ error: err.message });
  }
  console.error('flashcard mutation error:', err);
  return res.status(500).json({ error: 'Could not update flashcards' });
}

// PATCH /api/kits/:id/flashcards/:flashcardId
async function patchFlashcard(req, res) {
  try {
    const result = await updateFlashcard(req.params.id, req.params.flashcardId, req.body || {});
    return res.json(result);
  } catch (err) {
    return handleMutationError(err, res);
  }
}

// POST /api/kits/:id/flashcards
async function postFlashcard(req, res) {
  try {
    const result = await addFlashcard(req.params.id, req.body || {});
    return res.status(201).json(result);
  } catch (err) {
    return handleMutationError(err, res);
  }
}

// DELETE /api/kits/:id/flashcards/:flashcardId
async function removeFlashcard(req, res) {
  try {
    const result = await deleteFlashcard(req.params.id, req.params.flashcardId);
    return res.json(result);
  } catch (err) {
    return handleMutationError(err, res);
  }
}

// PUT /api/kits/:id/flashcards/reorder
async function putFlashcardsOrder(req, res) {
  try {
    const orderedIds = req.body?.orderedIds;
    const result = await reorderFlashcards(req.params.id, orderedIds);
    return res.json(result);
  } catch (err) {
    return handleMutationError(err, res);
  }
}

module.exports = {
  patchFlashcard,
  postFlashcard,
  removeFlashcard,
  putFlashcardsOrder,
};
