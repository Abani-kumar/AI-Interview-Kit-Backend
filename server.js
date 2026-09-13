// Load env before app/worker so Redis + LLM keys are available at import time.
require('./src/config/env');

const app = require('./src/app');
const connectDB = require('./src/config/db');
const { PORT } = require('./src/config/env');
const { verifyRedisConnection } = require('./src/config/redis');
const { reconcileStuckKits } = require('./src/queue/reconciler');

connectDB()
  .then(async () => {
    const redis = await verifyRedisConnection();
    console.log(
      `[redis] connected via ${redis.source} (${redis.host}:${redis.port}, tls=${redis.tls})`
    );

    // Recover stuck/stalled kits only after Mongo is connected.
    try {
      await reconcileStuckKits();
    } catch (err) {
      console.error('[reconciler] startup reconciliation failed:', err.message);
    }

    app.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
    });
  })
  .catch((err) => {
    console.error('Failed to start server:', err.message);
    process.exit(1);
  });
 