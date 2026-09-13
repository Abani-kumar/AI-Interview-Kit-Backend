const User = require('../models/User');
const { signToken, COOKIE_NAME, cookieOptions } = require('./token.util');

function sendAuthenticatedUser(res, user, status = 200) {
  const token = signToken(user._id.toString());
  return res
    .status(status)
    .cookie(COOKIE_NAME, token, cookieOptions)
    .json({ user, token });
}

async function register(req, res, next) {
  try {
    const { email, password, name } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password are required' });
    if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
    const normalizedEmail = email.trim().toLowerCase();
    if (await User.exists({ email: normalizedEmail })) return res.status(409).json({ error: 'Email already registered' });
    const user = await User.create({ email: normalizedEmail, password, name });
    return sendAuthenticatedUser(res, user, 201);
  } catch (err) { return next(err); }
}

async function login(req, res, next) {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password are required' });
    const user = await User.findOne({ email: email.trim().toLowerCase() });
    if (!user || !(await user.comparePassword(password))) return res.status(401).json({ error: 'Invalid email or password' });
    return sendAuthenticatedUser(res, user);
  } catch (err) { return next(err); }
}

function logout(req, res) {
  res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: undefined });
  return res.status(204).end();
}

function me(req, res) { return res.json({ user: req.user }); }
module.exports = { register, login, logout, me };
