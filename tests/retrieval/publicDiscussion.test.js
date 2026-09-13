jest.mock('../../src/llm/LLMClient');
jest.mock('../../src/searchProvider/SearchClient');

const { getLLMClient } = require('../../src/llm/LLMClient');
const { getSearchClient } = require('../../src/searchProvider/SearchClient');
const { SearchProviderError } = require('../../src/searchProvider/searchErrors');
const {
  searchPublicDiscussion,
  generateSearchQueries,
  fixedTemplateQueries,
} = require('../../src/retrieval/publicDiscussion');

describe('publicDiscussion search reliability', () => {
  const originalMaxQueries = process.env.MAX_SEARCH_QUERIES;
  const originalResultsPerQuery = process.env.SEARCH_RESULTS_PER_QUERY;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.MAX_SEARCH_QUERIES = '3';
    process.env.SEARCH_RESULTS_PER_QUERY = '3';
  });

  afterEach(() => {
    process.env.MAX_SEARCH_QUERIES = originalMaxQueries;
    process.env.SEARCH_RESULTS_PER_QUERY = originalResultsPerQuery;
  });

  test('uses fallback queries when query generation fails', async () => {
    getLLMClient.mockReturnValue({
      completeJSON: jest.fn().mockRejectedValue(new Error('LLM unavailable')),
    });

    const queries = await generateSearchQueries({ companyName: 'Acme' });
    expect(queries).toEqual(fixedTemplateQueries('Acme'));
  });

  test('does not let empty LLM queries consume slots before sanitization', async () => {
    getLLMClient.mockReturnValue({
      completeJSON: jest.fn().mockResolvedValue({
        queries: ['', '  Acme interview', 'acme interview', 'Acme interview questions'],
      }),
    });

    const searchClient = {
      search: jest.fn().mockResolvedValue({ results: [] }),
    };
    getSearchClient.mockReturnValue(searchClient);

    const result = await searchPublicDiscussion({
      companyName: 'Acme',
      roleTitle: 'Engineer',
      seniority: 'Senior',
      hiringPageFound: false,
    });

    expect(result.queriesUsed).toEqual(['Acme interview', 'Acme interview questions']);
    expect(searchClient.search).toHaveBeenCalledTimes(2);
  });

  test('skips empty and duplicate queries before searching', async () => {
    getLLMClient.mockReturnValue({
      completeJSON: jest.fn().mockResolvedValue({
        queries: ['', '  Acme interview', 'acme interview', 'Acme interview questions'],
      }),
    });

    const searchClient = {
      search: jest.fn().mockResolvedValue({
        results: [{ title: 'Tips', url: 'https://example.com/1', snippet: 'Snippet' }],
      }),
    };
    getSearchClient.mockReturnValue(searchClient);

    const result = await searchPublicDiscussion({
      companyName: 'Acme',
      roleTitle: 'Engineer',
      seniority: 'Senior',
      hiringPageFound: true,
    });

    expect(searchClient.search).toHaveBeenCalledTimes(2);
    expect(searchClient.search).toHaveBeenCalledWith('Acme interview', { count: 3 });
    expect(searchClient.search).toHaveBeenCalledWith('Acme interview questions', { count: 3 });
    expect(result.queriesUsed).toEqual(['Acme interview', 'Acme interview questions']);
    expect(result.errors.some((err) => err.type === 'query_skipped')).toBe(true);
    expect(result.results).toHaveLength(1);
  });

  test('continues remaining queries when one search fails', async () => {
    getLLMClient.mockReturnValue({
      completeJSON: jest.fn().mockResolvedValue({
        queries: ['Acme interview process', 'Acme interview questions'],
      }),
    });

    const searchClient = {
      search: jest
        .fn()
        .mockRejectedValueOnce(
          new SearchProviderError('The q parameter is required', {
            status: 422,
            code: 'VALIDATION',
            query: 'Acme interview process',
          })
        )
        .mockResolvedValueOnce({
          results: [{ title: 'Questions', url: 'https://example.com/q', snippet: 'Snippet' }],
        }),
    };
    getSearchClient.mockReturnValue(searchClient);

    const result = await searchPublicDiscussion({
      companyName: 'Acme',
      roleTitle: 'Engineer',
      seniority: 'Senior',
      hiringPageFound: false,
    });

    expect(searchClient.search).toHaveBeenCalledTimes(2);
    expect(result.results).toHaveLength(1);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatchObject({
      query: 'Acme interview process',
      type: 'search_failed',
      status: 422,
      code: 'VALIDATION',
    });
    expect(result.queriesUsed).toEqual(['Acme interview process', 'Acme interview questions']);
  });

  test('returns partial research state when every query fails', async () => {
    getLLMClient.mockReturnValue({
      completeJSON: jest.fn().mockResolvedValue({
        queries: ['Acme interview process'],
      }),
    });

    getSearchClient.mockReturnValue({
      search: jest.fn().mockRejectedValue(
        new SearchProviderError('The provided API key is invalid.', {
          status: 422,
          code: 'SUBSCRIPTION_TOKEN_INVALID',
          query: 'Acme interview process',
        })
      ),
    });

    const result = await searchPublicDiscussion({
      companyName: 'Acme',
      roleTitle: 'Engineer',
      seniority: 'Senior',
      hiringPageFound: false,
    });

    expect(result.results).toEqual([]);
    expect(result.queriesUsed).toEqual(['Acme interview process']);
    expect(result.errors[0]).toMatchObject({
      type: 'search_failed',
      status: 422,
      code: 'SUBSCRIPTION_TOKEN_INVALID',
    });
  });

  test('returns empty state when all generated queries are invalid', async () => {
    getLLMClient.mockReturnValue({
      completeJSON: jest.fn().mockResolvedValue({
        queries: ['', '   '],
      }),
    });

    getSearchClient.mockReturnValue({
      search: jest.fn(),
    });

    const result = await searchPublicDiscussion({
      companyName: 'Acme',
      roleTitle: 'Engineer',
      seniority: 'Senior',
      hiringPageFound: false,
    });

    expect(getSearchClient().search).not.toHaveBeenCalled();
    expect(result.results).toEqual([]);
    expect(result.queriesUsed).toEqual([]);
    expect(result.errors.every((err) => err.type === 'query_skipped')).toBe(true);
  });
});
