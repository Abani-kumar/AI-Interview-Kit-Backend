// BullMQ Redis connection — configured via src/config/redis.js (Upstash-ready).
const { createRedisConnection, getRedisConnectionSummary } = require('../config/redis');

module.exports = { createRedisConnection, getRedisConnectionSummary };
