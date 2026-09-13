const Kit = require('../models/Kit');
const { createAndEnqueueKit, FIRST_STAGE } = require('./createAndEnqueueKit');

// POST /api/kits
// FIX #4: if Redis enqueue fails after Mongo write, mark the kit failed
// rather than leaving it stuck in 'queued' forever.
async function createKit(req, res) {
  try {
    const { jd, companyUrl, company_url, days } = req.body;
    const resolvedCompanyUrl = companyUrl || company_url;

    if (!jd || !resolvedCompanyUrl || days == null) {
      return res.status(400).json({ error: 'jd, companyUrl (or company_url), and days are required' });
    }

    console.log(`[kits] creating kit days=${days} company=${resolvedCompanyUrl}`);

    let kit;
    try {
      kit = await createAndEnqueueKit({
        userId: req.user._id,
        jd,
        companyUrl: resolvedCompanyUrl,
        days,
      });
      console.log(`[kits] created kit=${kit._id} enqueued ${FIRST_STAGE}`);
    } catch (enqueueErr) {
      console.error(`[kits] enqueue failed:`, enqueueErr.message);
      return res.status(202).json({
        kitId: enqueueErr.kitId,
        status: 'stalled',
        message: 'Kit created but could not be queued immediately. It will be recovered automatically.',
      });
    }

    return res.status(201).json({
      kitId: kit._id,
      status: 'queued',
      progressUrl: `/api/kits/${kit._id}/progress`,
      kitUrl: `/api/kits/${kit._id}`,
    });
  } catch (err) {
    console.error('createKit error:', err);
    return res.status(500).json({ error: 'Could not create kit' });
  }
}

// GET /api/kits — list user's own kits
async function listKits(req, res) {
  try {
    const kits = await Kit.find({ userId: req.user._id })
      .select('status currentStage stages createdAt updatedAt input.companyUrl')
      .sort({ createdAt: -1 });
    return res.json({ kits });
  } catch (err) {
    return res.status(500).json({ error: 'Could not fetch kits' });
  }
}

// GET /api/kits/:id — full kit doc (protect + ownsKit verified ownership)
async function getKit(req, res) {
  return res.json({ kit: req.kit });
}

// DELETE /api/kits/:id
async function deleteKit(req, res) {
  try {
    await req.kit.deleteOne();
    return res.status(204).send();
  } catch (err) {
    return res.status(500).json({ error: 'Could not delete kit' });
  }
}

module.exports = { createKit, listKits, getKit, deleteKit };
