const { requestRegeneration } = require('./regenerate.mutations');

function handleRegenerationError(res, err) {
  if (err.status) {
    const body = { error: err.message };
    if (err.details) body.details = err.details;
    return res.status(err.status).json(body);
  }
  console.error('regeneration error:', err);
  return res.status(500).json({ error: 'Regeneration request failed' });
}

async function postRegenerateBrief(req, res) {
  try {
    const result = await requestRegeneration(req.params.id, 'brief', {
      contentRevision: req.body?.contentRevision,
    });
    return res.status(202).json(result);
  } catch (err) {
    return handleRegenerationError(res, err);
  }
}

async function postRegenerateQuestions(req, res) {
  try {
    const result = await requestRegeneration(req.params.id, 'questions', {
      contentRevision: req.body?.contentRevision,
      missingRequirementIds: req.body?.missingRequirementIds,
    });
    return res.status(202).json(result);
  } catch (err) {
    return handleRegenerationError(res, err);
  }
}

async function postRegenerateFlashcards(req, res) {
  try {
    const result = await requestRegeneration(req.params.id, 'flashcards', {
      contentRevision: req.body?.contentRevision,
    });
    return res.status(202).json(result);
  } catch (err) {
    return handleRegenerationError(res, err);
  }
}

module.exports = {
  postRegenerateBrief,
  postRegenerateQuestions,
  postRegenerateFlashcards,
};
