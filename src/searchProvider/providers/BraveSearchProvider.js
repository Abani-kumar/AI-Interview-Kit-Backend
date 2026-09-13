const { PublicSearchProvider } = require('../PublicSearchProvider');
const { getResultsPerQuery, MIN_RESULTS_PER_QUERY, MAX_RESULTS_PER_QUERY } = require('../searchConfig');
const { validateSearchQuery } = require('../querySanitizer');
const { SearchProviderError, SearchValidationError } = require('../searchErrors');

class BraveSearchProvider extends PublicSearchProvider {
  constructor(config = {}) {
    super(config);
    this.apiKey = config.apiKey;
    this.endpoint = 'https://api.search.brave.com/res/v1/web/search';
  }

  clampCount(count) {
    const fallback = getResultsPerQuery();
    const parsed = Number.isInteger(count) ? count : parseInt(count, 10);
    if (!Number.isInteger(parsed) || parsed < MIN_RESULTS_PER_QUERY) {
      return fallback;
    }
    return Math.min(parsed, MAX_RESULTS_PER_QUERY);
  }

  buildRequestUrl(query, count) {
    const params = new URLSearchParams({
      q: query,
      count: String(count),
    });
    return `${this.endpoint}?${params.toString()}`;
  }

  async parseErrorBody(res) {
    try {
      const data = await res.json();
      const code = data?.error?.code || null;
      const message = data?.error?.detail || data?.error?.message || `Brave Search request failed with status ${res.status}`;
      return { code, message };
    } catch {
      return {
        code: null,
        message: `Brave Search request failed with status ${res.status}`,
      };
    }
  }

  async search(query, options = {}) {
    const validation = validateSearchQuery(query);
    if (!validation.valid) {
      throw new SearchValidationError(`Invalid search query: ${validation.reason}`, {
        query: typeof query === 'string' ? query : '',
      });
    }

    if (!this.apiKey || typeof this.apiKey !== 'string' || this.apiKey.trim() === '') {
      throw new SearchProviderError('SEARCH_API_KEY is missing or empty', {
        status: 401,
        code: 'SUBSCRIPTION_TOKEN_INVALID',
        query: validation.query,
      });
    }

    const count = this.clampCount(options.count);
    const url = this.buildRequestUrl(validation.query, count);
    const timeoutMs = Number.isInteger(options.timeoutMs) ? options.timeoutMs : 8000;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetch(url, {
        signal: controller.signal,
        headers: {
          Accept: 'application/json',
          'X-Subscription-Token': this.apiKey.trim(),
        },
      });

      if (res.status === 429) {
        const body = await this.parseErrorBody(res);
        throw new SearchProviderError(body.message || 'Brave Search rate limit exceeded', {
          status: 429,
          code: body.code || 'RATE_LIMITED',
          query: validation.query,
        });
      }

      if (!res.ok) {
        const body = await this.parseErrorBody(res);
        throw new SearchProviderError(body.message, {
          status: res.status,
          code: body.code,
          query: validation.query,
        });
      }

      const data = await res.json();
      const results = (data.web?.results || []).map((r) => ({
        title: r.title || '',
        url: r.url || '',
        snippet: r.description || '',
      }));

      return { results, error: null };
    } catch (err) {
      if (err instanceof SearchProviderError) {
        throw err;
      }
      if (err.name === 'AbortError') {
        throw new SearchProviderError('Brave Search request timed out', {
          status: 408,
          code: 'TIMEOUT',
          query: validation.query,
        });
      }
      throw new SearchProviderError(`Brave Search error: ${err.message}`, {
        status: null,
        code: 'NETWORK_ERROR',
        query: validation.query,
      });
    } finally {
      clearTimeout(timeout);
    }
  }
}

module.exports = { BraveSearchProvider };
