const {
  moveQuestion,
  reorderDayQuestions,
  updateDayFocus,
} = require('./schedule.mutations');

function handleMutationError(err, res) {
  if (err.status) {
    return res.status(err.status).json({ error: err.message });
  }
  console.error('schedule mutation error:', err);
  return res.status(500).json({ error: 'Could not update schedule' });
}

// POST /api/kits/:id/schedule/move
// Body: { questionId, toDay, index? }
async function postMoveQuestion(req, res) {
  try {
    const result = await moveQuestion(req.params.id, req.body || {});
    return res.json(result);
  } catch (err) {
    return handleMutationError(err, res);
  }
}

// PUT /api/kits/:id/schedule/days/:dayNumber/reorder
// Body: { orderedIds: string[] }
async function putDayQuestionsOrder(req, res) {
  try {
    const dayNumber = Number(req.params.dayNumber);
    const orderedIds = req.body?.orderedIds;
    const result = await reorderDayQuestions(req.params.id, dayNumber, orderedIds);
    return res.json(result);
  } catch (err) {
    return handleMutationError(err, res);
  }
}

// PATCH /api/kits/:id/schedule/days/:dayNumber
// Body: { focus: string }
async function patchDayFocus(req, res) {
  try {
    const dayNumber = Number(req.params.dayNumber);
    const result = await updateDayFocus(req.params.id, dayNumber, req.body || {});
    return res.json(result);
  } catch (err) {
    return handleMutationError(err, res);
  }
}

module.exports = {
  postMoveQuestion,
  putDayQuestionsOrder,
  patchDayFocus,
};
