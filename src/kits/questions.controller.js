const {
  updateQuestion,
  addQuestion,
  deleteQuestion,
  reorderQuestions,
} = require('./questions.mutations');

function handleMutationError(err, res) {
  if (err.status) {
    return res.status(err.status).json({ error: err.message });
  }
  console.error('question mutation error:', err);
  return res.status(500).json({ error: 'Could not update questions' });
}

// PATCH /api/kits/:id/questions/:questionId
async function patchQuestion(req, res) {
  try {
    const result = await updateQuestion(req.params.id, req.params.questionId, req.body || {});
    return res.json(result);
  } catch (err) {
    return handleMutationError(err, res);
  }
}

// POST /api/kits/:id/questions
async function postQuestion(req, res) {
  try {
    const result = await addQuestion(req.params.id, req.body || {});
    return res.status(201).json(result);
  } catch (err) {
    return handleMutationError(err, res);
  }
}

// DELETE /api/kits/:id/questions/:questionId
async function removeQuestion(req, res) {
  try {
    const result = await deleteQuestion(req.params.id, req.params.questionId);
    return res.json(result);
  } catch (err) {
    return handleMutationError(err, res);
  }
}

// PUT /api/kits/:id/questions/reorder
async function putQuestionsOrder(req, res) {
  try {
    const orderedIds = req.body?.orderedIds;
    const result = await reorderQuestions(req.params.id, orderedIds);
    return res.json(result);
  } catch (err) {
    return handleMutationError(err, res);
  }
}

module.exports = {
  patchQuestion,
  postQuestion,
  removeQuestion,
  putQuestionsOrder,
};
