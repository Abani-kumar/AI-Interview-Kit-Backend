const jwt = require('jsonwebtoken');
const { JWT_SECRET, JWT_EXPIRES_IN, NODE_ENV } = require('../config/env');

function signToken(userId) {
  return jwt.sign({ sub: userId }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
}

function verifyToken(token) {
  return jwt.verify(token, JWT_SECRET);
}

const COOKIE_NAME = 'token';
// Cross-origin frontend (e.g. Vercel) + API (e.g. Code.run) needs SameSite=None.
const cookieOptions = {
  httpOnly: true,
  secure: NODE_ENV === 'production',
  sameSite: NODE_ENV === 'production' ? 'none' : 'lax',
  maxAge: 7 * 24 * 60 * 60 * 1000,
};

module.exports = { signToken, verifyToken, COOKIE_NAME, cookieOptions };
