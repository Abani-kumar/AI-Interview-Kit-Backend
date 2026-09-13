const { updateCompanyBrief } = require('./brief.mutations');

function handleMutationError(err, res) {
  if (err.status) {
    return res.status(err.status).json({ error: err.message });
  }
  console.error('company brief mutation error:', err);
  return res.status(500).json({ error: 'Could not update company brief' });
}

// PATCH /api/kits/:id/company-brief
async function patchCompanyBrief(req, res) {
  try {
    const result = await updateCompanyBrief(req.params.id, req.body || {});
    return res.json(result);
  } catch (err) {
    return handleMutationError(err, res);
  }
}

module.exports = { patchCompanyBrief };
