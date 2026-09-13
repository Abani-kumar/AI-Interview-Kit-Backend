const Kit = require('../models/Kit');

async function loadKit(req, res, next) {
  try {
    const kit = await Kit.findById(req.params.id);
    if (!kit) {
      return res.status(404).json({ error: 'Kit not found' });
    }
    req.kit = kit;
    return next();
  } catch (err) {
    console.error('loadKit error:', err);
    return res.status(500).json({ error: 'Could not load kit' });
  }
}

module.exports = loadKit;
