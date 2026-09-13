const User = require('../models/User');
const { verifyToken, COOKIE_NAME } = require('./token.util');

// Protects any route it's attached to. A signed-out or invalid-session
// visitor gets a 401 and never reaches the handler.
async function protect(req, res, next) {
  try {
    const token = req.cookies?.[COOKIE_NAME];

    if (!token) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    let payload;
    try {
      payload = verifyToken(token);
    } catch (err) {
      // Covers both expired and malformed/invalid tokens
      return res.status(401).json({ error: 'Session expired or invalid, please log in again' });
    }

    const user = await User.findById(payload.sub);
    if (!user) {
      // Token is valid but the user no longer exists — treat as logged out
      return res.status(401).json({ error: 'Session expired or invalid, please log in again' });
    }

    req.user = user;
    next();
  } catch (err) {
    console.error('Auth middleware error:', err);
    return res.status(500).json({ error: 'Authentication check failed' });
  }
}

// Sets req.user when a valid session cookie is present; never blocks the request.
async function optionalProtect(req, res, next) {
  try {
    const token = req.cookies?.[COOKIE_NAME];
    if (!token) return next();

    let payload;
    try {
      payload = verifyToken(token);
    } catch {
      return next();
    }

    const user = await User.findById(payload.sub);
    if (user) req.user = user;
    return next();
  } catch (err) {
    console.error('Optional auth middleware error:', err);
    return next();
  }
}

module.exports = { protect, optionalProtect };