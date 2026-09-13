const mongoose = require('mongoose');
const Kit = require('../models/Kit');
const { NODE_ENV } = require('../config/env');

// Kits created before auth was wired on POST /kits use this placeholder owner.
const DEV_USER_ID = new mongoose.Types.ObjectId('000000000000000000000001');

// Must follow protect: it relies on req.user being available.
async function ownsKit(req, res, next) {
  try {
    const kit = await Kit.findById(req.params.id);
    if (!kit) {
      return res.status(404).json({ error: 'Kit not found' });
    }

    const kitOwnerId = kit.userId.toString();
    const userId = req.user._id.toString();

    // A shared response prevents leaking the existence of another user's kit.
    if (kitOwnerId !== userId) {
      const isDevPlaceholderKit =
        NODE_ENV !== 'production' && kitOwnerId === DEV_USER_ID.toString();
      if (!isDevPlaceholderKit) {
        return res.status(404).json({ error: 'Kit not found' });
      }
    }
    req.kit = kit;
    return next();
  } catch (err) {
    console.error('ownsKit error:', err);
    return res.status(500).json({ error: 'Could not verify kit ownership' });
  }
}

module.exports = ownsKit;
