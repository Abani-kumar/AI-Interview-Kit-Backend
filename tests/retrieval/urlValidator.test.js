jest.mock('dotenv', () => ({ config: jest.fn() }));

const dns = require('dns').promises;

describe('urlValidator', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
    delete process.env.ALLOW_LOCAL_FETCH_TARGETS;
    jest.spyOn(dns, 'lookup').mockResolvedValue({ address: '93.184.216.34', family: 4 });
  });

  afterEach(() => {
    process.env = originalEnv;
    jest.restoreAllMocks();
  });

  test('accepts valid public https URLs', async () => {
    const { validateAndNormalizeUrl } = require('../../src/retrieval/urlValidator');
    const normalized = await validateAndNormalizeUrl('https://example.com/path');
    expect(normalized).toBe('https://example.com/path');
  });

  test('rejects invalid URLs', async () => {
    const { validateAndNormalizeUrl } = require('../../src/retrieval/urlValidator');
    await expect(validateAndNormalizeUrl('not-a-url')).rejects.toThrow('Invalid URL');
  });

  test('rejects unsupported protocols', async () => {
    const { validateAndNormalizeUrl } = require('../../src/retrieval/urlValidator');
    await expect(validateAndNormalizeUrl('ftp://example.com')).rejects.toThrow('Unsupported protocol');
  });

  test('rejects localhost in production mode', async () => {
    const { validateAndNormalizeUrl } = require('../../src/retrieval/urlValidator');
    await expect(validateAndNormalizeUrl('http://localhost:3000')).rejects.toThrow('Refusing to fetch localhost');
  });

  test('allows localhost when ALLOW_LOCAL_FETCH_TARGETS=true', async () => {
    process.env.ALLOW_LOCAL_FETCH_TARGETS = 'true';
    const { validateAndNormalizeUrl } = require('../../src/retrieval/urlValidator');
    const normalized = await validateAndNormalizeUrl('http://localhost:3000/page');
    expect(normalized).toBe('http://localhost:3000/page');
  });

  test('rejects private IP literals', async () => {
    const { validateAndNormalizeUrl } = require('../../src/retrieval/urlValidator');
    await expect(validateAndNormalizeUrl('http://192.168.1.10')).rejects.toThrow('private/loopback address');
  });

  test('rejects hostnames resolving to private addresses', async () => {
    dns.lookup.mockResolvedValue({ address: '127.0.0.1', family: 4 });
    const { validateAndNormalizeUrl } = require('../../src/retrieval/urlValidator');
    await expect(validateAndNormalizeUrl('https://public-looking.example')).rejects.toThrow(
      'resolves to a private address'
    );
  });

  test('rejects unresolved hostnames', async () => {
    dns.lookup.mockRejectedValue(new Error('ENOTFOUND'));
    const { validateAndNormalizeUrl } = require('../../src/retrieval/urlValidator');
    await expect(validateAndNormalizeUrl('https://missing.example')).rejects.toThrow('Could not resolve hostname');
  });
});
