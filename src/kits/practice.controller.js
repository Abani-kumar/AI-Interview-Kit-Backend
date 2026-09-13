const { recordPracticeAttempt, getPracticeSummary } = require('./practice.mutations');

function handlePracticeError(err, res) {
  if (err.status) {
    return res.status(err.status).json({ error: err.message });
  }
  console.error('practice error:', err);
  return res.status(500).json({ error: 'Could not update practice state' });
}

// GET /api/kits/:id/practice
async function getPractice(req, res) {
  try {
    const summary = await getPracticeSummary(req.params.id);
    return res.json(summary);
  } catch (err) {
    return handlePracticeError(err, res);
  }
}

// POST /api/kits/:id/practice/flashcards/:flashcardId
async function postPracticeAttempt(req, res) {
  try {
    const result = await recordPracticeAttempt(
      req.params.id,
      req.params.flashcardId,
      req.body || {}
    );
    return res.status(result.idempotent ? 200 : 201).json(result);
  } catch (err) {
    return handlePracticeError(err, res);
  }
}

module.exports = {
  getPractice,
  postPracticeAttempt,
};
