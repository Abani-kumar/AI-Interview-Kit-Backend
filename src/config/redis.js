// Redis / Upstash configuration for BullMQ.
// Supports:
//   1. REDIS_URL or rediss:// URL (Upstash TCP URL from dashboard)
//   2. REDIS_HOST + REDIS_PORT + REDIS_PASSWORD + REDIS_TLS (+ optional REDIS_USERNAME)
//   3. Local dev fallback: redis://localhost:6379

require('./env');

const IORedis = require('ioredis');

const BULLMQ_REDIS_OPTIONS = {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
  // Upstash / cloud Redis: dual-stack DNS avoids some TLS connection failures.
  family: 0,
  retryStrategy(times) {
    if (times > 10) return null;
    return Math.min(times * 200, 3000);
  },
};

function isTruthy(value) {
  return ['true', '1', 'yes', 'on'].includes(String(value || '').toLowerCase());
}

function cleanEnvValue(value) {
  if (value == null) return '';
  return String(value)
    .trim()
    .replace(/^REDIS_URL\s*=\s*/i, '')
    .replace(/^['"]|['"]$/g, '');
}

function isRedisUrl(value) {
  return /^rediss?:\/\//i.test(value);
}

function extractRedisUrl(value) {
  const cleaned = cleanEnvValue(value);
  if (isRedisUrl(cleaned)) return cleaned;

  const match = cleaned.match(/(rediss?:\/\/[^\s'"]+)/i);
  return match ? match[1] : null;
}

function normalizeRedisUrl(value) {
  if (!value) return null;
  const url = extractRedisUrl(value);
  return url && isRedisUrl(url) ? url : null;
}

function resolveRedisConfig() {
  const candidates = [
    ['REDIS_URL', process.env.REDIS_URL],
    ['REDIS_HOST', process.env.REDIS_HOST],
  ];

  for (const [source, raw] of candidates) {
    const url = normalizeRedisUrl(raw);
    if (url) {
      return { mode: 'url', url, source };
    }
  }

  const host = cleanEnvValue(process.env.REDIS_HOST);
  const password = cleanEnvValue(process.env.REDIS_PASSWORD);
  const port = Number.parseInt(cleanEnvValue(process.env.REDIS_PORT) || '6379', 10);
  const username = cleanEnvValue(process.env.REDIS_USERNAME) || 'default';
  const tlsEnabled = isTruthy(process.env.REDIS_TLS) || host.endsWith('.upstash.io');

  if (host && password && !host.includes('://')) {
    return {
      mode: 'options',
      source: 'REDIS_HOST',
      options: {
        host,
        port,
        username,
        password,
        ...(tlsEnabled ? { tls: {} } : {}),
        ...BULLMQ_REDIS_OPTIONS,
      },
    };
  }

  return {
    mode: 'url',
    url: 'redis://localhost:6379',
    source: 'default',
  };
}

function createRedisConnection() {
  const config = resolveRedisConfig();

  if (config.mode === 'url') {
    return new IORedis(config.url, BULLMQ_REDIS_OPTIONS);
  }

  return new IORedis(config.options);
}

function getRedisConnectionSummary() {
  const config = resolveRedisConfig();

  if (config.mode === 'url') {
    try {
      const parsed = new URL(config.url);
      return {
        source: config.source,
        mode: config.mode,
        host: parsed.hostname,
        port: parsed.port || '6379',
        tls: parsed.protocol === 'rediss:',
      };
    } catch {
      return { source: config.source, mode: config.mode, url: 'configured' };
    }
  }

  return {
    source: config.source,
    mode: config.mode,
    host: config.options.host,
    port: config.options.port,
    tls: Boolean(config.options.tls),
    username: config.options.username,
  };
}

async function verifyRedisConnection() {
  const summary = getRedisConnectionSummary();
  const client = createRedisConnection();

  try {
    const pong = await client.ping();
    if (pong !== 'PONG') {
      throw new Error(`Unexpected Redis ping response: ${pong}`);
    }
    return summary;
  } catch (err) {
    const hint =
      summary.source === 'default'
        ? 'No REDIS_URL / REDIS_HOST configured — falling back to localhost:6379. Start local Redis or set Upstash env vars.'
        : 'Check REDIS_HOST, REDIS_PASSWORD, REDIS_TLS, or use REDIS_URL=rediss://default:TOKEN@host:6379';

    throw new Error(
      `Redis connection failed (${summary.host}:${summary.port}, tls=${summary.tls}): ${err.message || err.code || err}. ${hint}`
    );
  } finally {
    client.disconnect();
  }
}

module.exports = {
  resolveRedisConfig,
  createRedisConnection,
  getRedisConnectionSummary,
  verifyRedisConnection,
};
