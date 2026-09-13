jest.mock('dotenv', () => ({ config: jest.fn() }));

const dns = require('dns').promises;

describe('httpFetcher', () => {
  const originalFetch = global.fetch;
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
    delete process.env.ALLOW_LOCAL_FETCH_TARGETS;
    jest.spyOn(dns, 'lookup').mockResolvedValue({ address: '93.184.216.34', family: 4 });
  });

  afterEach(() => {
    global.fetch = originalFetch;
    process.env = originalEnv;
    jest.restoreAllMocks();
  });

  test('returns skipped result for unsupported content types', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      status: 200,
      headers: {
        get: (name) => (name === 'content-type' ? 'application/json' : null),
      },
      body: null,
      text: async () => '{"ok":true}',
    });

    const { httpFetch } = require('../../src/retrieval/httpFetcher');
    const result = await httpFetch('https://example.com/data.json');

    expect(result.skipped).toBe(true);
    expect(result.reason).toBe('unsupported_content_type');
  });

  test('rejects redirect chains that exceed the hop limit', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce({
        status: 302,
        headers: { get: (name) => (name === 'location' ? '/hop1' : null) },
      })
      .mockResolvedValueOnce({
        status: 302,
        headers: { get: (name) => (name === 'location' ? '/hop2' : null) },
      })
      .mockResolvedValueOnce({
        status: 302,
        headers: { get: (name) => (name === 'location' ? '/hop3' : null) },
      })
      .mockResolvedValueOnce({
        status: 302,
        headers: { get: (name) => (name === 'location' ? '/hop4' : null) },
      });

    const { httpFetch } = require('../../src/retrieval/httpFetcher');
    await expect(httpFetch('https://example.com/start')).rejects.toThrow('Too many redirects');
  });

  test('rejects redirects to private addresses', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      status: 302,
      headers: { get: (name) => (name === 'location' ? 'http://127.0.0.1/internal' : null) },
    });

    const { httpFetch } = require('../../src/retrieval/httpFetcher');
    await expect(httpFetch('https://example.com/start')).rejects.toThrow('Refusing to fetch private/loopback');
  });
});
