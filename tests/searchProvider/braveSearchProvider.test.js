const { BraveSearchProvider } = require('../../src/searchProvider/providers/BraveSearchProvider');
const { SearchValidationError } = require('../../src/searchProvider/searchErrors');

describe('BraveSearchProvider', () => {
  const originalFetch = global.fetch;
  const originalResultsPerQuery = process.env.SEARCH_RESULTS_PER_QUERY;

  beforeEach(() => {
    global.fetch = jest.fn();
    process.env.SEARCH_RESULTS_PER_QUERY = '3';
  });

  afterEach(() => {
    process.env.SEARCH_RESULTS_PER_QUERY = originalResultsPerQuery;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  function provider() {
    return new BraveSearchProvider({ apiKey: 'test-api-key' });
  }

  test('builds a valid search request URL with encoded query parameters', async () => {
    global.fetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        web: {
          results: [
            { title: 'Interview tips', url: 'https://example.com/tips', description: 'Snippet' },
          ],
        },
      }),
    });

    const result = await provider().search('Acme interview process', { count: 3 });

    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [url, options] = global.fetch.mock.calls[0];
    expect(url).toBe('https://api.search.brave.com/res/v1/web/search?q=Acme+interview+process&count=3');
    expect(options.headers.Accept).toBe('application/json');
    expect(options.headers['X-Subscription-Token']).toBe('test-api-key');
    expect(result.results).toEqual([
      { title: 'Interview tips', url: 'https://example.com/tips', snippet: 'Snippet' },
    ]);
  });

  test('rejects empty queries before calling the provider', async () => {
    await expect(provider().search('   ')).rejects.toBeInstanceOf(SearchValidationError);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('clamps invalid count values to a safe default', async () => {
    global.fetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ web: { results: [] } }),
    });

    await provider().search('Acme interview', { count: 0 });

    const [url] = global.fetch.mock.calls[0];
    expect(url).toContain('count=3');
  });

  test('parses provider 422 responses into structured errors', async () => {
    global.fetch.mockResolvedValue({
      ok: false,
      status: 422,
      json: async () => ({
        error: {
          code: 'VALIDATION',
          detail: 'The q parameter is required',
        },
      }),
    });

    await expect(provider().search('Acme interview')).rejects.toMatchObject({
      status: 422,
      code: 'VALIDATION',
      message: 'The q parameter is required',
    });
  });

  test('maps 429 rate limits to structured errors', async () => {
    global.fetch.mockResolvedValue({
      ok: false,
      status: 429,
      json: async () => ({
        error: { code: 'RATE_LIMITED', detail: 'Too many requests' },
      }),
    });

    await expect(provider().search('Acme interview')).rejects.toMatchObject({
      status: 429,
      code: 'RATE_LIMITED',
    });
  });
});
