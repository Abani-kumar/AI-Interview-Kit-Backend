class SearchProviderError extends Error {
  constructor(message, { status = null, code = null, query = null } = {}) {
    super(message);
    this.name = 'SearchProviderError';
    this.status = status;
    this.code = code;
    this.query = query;
  }
}

class SearchValidationError extends SearchProviderError {
  constructor(message, { query = null } = {}) {
    super(message, { status: 400, code: 'VALIDATION', query });
    this.name = 'SearchValidationError';
  }
}

module.exports = { SearchProviderError, SearchValidationError };
