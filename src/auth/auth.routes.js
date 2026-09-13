const express = require('express');
const { register, login, logout, me } = require('./auth.controller');
const { protect } = require('./auth.middleware');

const router = express.Router();

router.post('/register', register);
router.post('/login', login);
router.post('/logout', logout);
router.get('/me', protect, me);

module.exports = router;