const express = require('express');
const cookieParser = require('cookie-parser');
const cors = require('cors');

const authRoutes = require('./auth/auth.routes');
const kitRoutes = require('./kits/kit.routes'); // FIX #7: routes already carry protect + ownsKit
const { mountSwagger } = require('./config/swagger');

// Start the worker by importing it (side effect registers the BullMQ processor)
require('./queue/worker');

const app = express();

app.use(express.json());
app.use(cookieParser());
const frontendOrigin = (process.env.FRONTEND_URL || 'http://localhost:3000')
  .trim()
  .replace(/\/$/, '');

app.use(
  cors({
    origin: frontendOrigin,
    credentials: true,
  })
);

mountSwagger(app);

app.get('/api/health', (req, res) => res.json({ ok: true }));
app.use('/api/auth', authRoutes);
app.use('/api/kits', kitRoutes); // all ownership checks live inside kit.routes.js

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Something went wrong' });
});

module.exports = app;
