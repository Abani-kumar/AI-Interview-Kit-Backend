jest.mock('dotenv', () => ({ config: jest.fn() }));

describe('redis config', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
    process.env.MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/test';
    process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
    delete process.env.REDIS_URL;
    delete process.env.REDIS_HOST;
    delete process.env.REDIS_PORT;
    delete process.env.REDIS_PASSWORD;
    delete process.env.REDIS_TLS;
    delete process.env.REDIS_USERNAME;
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  test('uses Upstash host/port/password with TLS', () => {
    process.env.REDIS_HOST = 'magical-blowfish.upstash.io';
    process.env.REDIS_PORT = '6379';
    process.env.REDIS_PASSWORD = 'secret-token';
    process.env.REDIS_TLS = 'true';

    const { resolveRedisConfig } = require('../src/config/redis');
    const config = resolveRedisConfig();

    expect(config.mode).toBe('options');
    expect(config.options).toMatchObject({
      host: 'magical-blowfish.upstash.io',
      port: 6379,
      password: 'secret-token',
      username: 'default',
      tls: {},
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
    });
  });

  test('auto-enables TLS for upstash.io hosts', () => {
    process.env.REDIS_HOST = 'my-db.upstash.io';
    process.env.REDIS_PASSWORD = 'secret-token';

    const { resolveRedisConfig } = require('../src/config/redis');
    expect(resolveRedisConfig().options.tls).toEqual({});
  });

  test('prefers REDIS_URL when set', () => {
    process.env.REDIS_URL = 'rediss://default:token@host.upstash.io:6379';
    process.env.REDIS_HOST = 'ignored';

    const { resolveRedisConfig } = require('../src/config/redis');
    expect(resolveRedisConfig()).toMatchObject({
      mode: 'url',
      url: 'rediss://default:token@host.upstash.io:6379',
    });
  });

  test('accepts full URL accidentally pasted into REDIS_HOST', () => {
    process.env.REDIS_HOST =
      'rediss://default:token@magical-blowfish.upstash.io:6379';

    const { resolveRedisConfig } = require('../src/config/redis');
    expect(resolveRedisConfig().mode).toBe('url');
  });

  test('falls back to localhost when nothing configured', () => {
    const { resolveRedisConfig } = require('../src/config/redis');
    expect(resolveRedisConfig()).toMatchObject({
      mode: 'url',
      url: 'redis://localhost:6379',
      source: 'default',
    });
  });
});
