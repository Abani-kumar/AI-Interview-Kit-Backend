const {
  updateRequirement,
  addRequirement,
  deleteRequirement,
  reorderRequirements,
} = require('./requirements.mutations');

function handleMutationError(err, res) {
  if (err.status) {
    return res.status(err.status).json({ error: err.message });
  }
  console.error('requirement mutation error:', err);
  return res.status(500).json({ error: 'Could not update requirements' });
}

// PATCH /api/kits/:id/requirements/:requirementId
async function patchRequirement(req, res) {
  try {
    const result = await updateRequirement(req.params.id, req.params.requirementId, req.body || {});
    return res.json(result);
  } catch (err) {
    return handleMutationError(err, res);
  }
}

// POST /api/kits/:id/requirements
async function postRequirement(req, res) {
  try {
    const result = await addRequirement(req.params.id, req.body || {});
    return res.status(201).json(result);
  } catch (err) {
    return handleMutationError(err, res);
  }
}

// DELETE /api/kits/:id/requirements/:requirementId
async function removeRequirement(req, res) {
  try {
    const result = await deleteRequirement(req.params.id, req.params.requirementId);
    return res.json(result);
  } catch (err) {
    return handleMutationError(err, res);
  }
}

// PUT /api/kits/:id/requirements/reorder
async function putRequirementsOrder(req, res) {
  try {
    const orderedIds = req.body?.orderedIds;
    const result = await reorderRequirements(req.params.id, orderedIds);
    return res.json(result);
  } catch (err) {
    return handleMutationError(err, res);
  }
}

module.exports = {
  patchRequirement,
  postRequirement,
  removeRequirement,
  putRequirementsOrder,
};
