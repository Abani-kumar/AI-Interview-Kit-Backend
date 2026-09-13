const {
  pinQuestion,
  unpinQuestion,
  pinFlashcard,
  unpinFlashcard,
} = require('./pin.mutations');

function handleMutationError(err, res) {
  if (err.status) {
    return res.status(err.status).json({ error: err.message });
  }
  console.error('pin mutation error:', err);
  return res.status(500).json({ error: 'Could not update pin state' });
}

// POST /api/kits/:id/questions/:questionId/pin
async function postPinQuestion(req, res) {
  try {
    const result = await pinQuestion(req.params.id, req.params.questionId);
    return res.json(result);
  } catch (err) {
    return handleMutationError(err, res);
  }
}

// POST /api/kits/:id/questions/:questionId/unpin
async function postUnpinQuestion(req, res) {
  try {
    const result = await unpinQuestion(req.params.id, req.params.questionId);
    return res.json(result);
  } catch (err) {
    return handleMutationError(err, res);
  }
}

// POST /api/kits/:id/flashcards/:flashcardId/pin
async function postPinFlashcard(req, res) {
  try {
    const result = await pinFlashcard(req.params.id, req.params.flashcardId);
    return res.json(result);
  } catch (err) {
    return handleMutationError(err, res);
  }
}

// POST /api/kits/:id/flashcards/:flashcardId/unpin
async function postUnpinFlashcard(req, res) {
  try {
    const result = await unpinFlashcard(req.params.id, req.params.flashcardId);
    return res.json(result);
  } catch (err) {
    return handleMutationError(err, res);
  }
}

module.exports = {
  postPinQuestion,
  postUnpinQuestion,
  postPinFlashcard,
  postUnpinFlashcard,
};
