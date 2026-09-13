// Shared error classification for provider fallback and retry logic.

function getStatusCode(error) {
  if (!error) return null;
  if (error.statusCode) return error.statusCode;
  if (error.status) return error.status;
  if (error.cause?.status) return error.cause.status;
  if (error.cause?.statusCode) return error.cause.statusCode;
  return null;
}

function getErrorText(error) {
  const parts = [error?.message, error?.cause?.message, String(error)].filter(Boolean);
  return parts.join(' ');
}

function shouldFallbackToGroq(error) {
  const statusCode = getStatusCode(error);

  // Gemini quota / rate limit
  if (statusCode === 429) return true;

  const errorText = getErrorText(error);
  if (errorText.includes('429')) return true;
  if (errorText.includes('RESOURCE_EXHAUSTED')) return true;

  // Gemini transient server problems (5xx)
  if (statusCode && statusCode >= 500) return true;

  // TCP / transport failures
  if (error instanceof TypeError && /fetch failed/i.test(errorText)) return true;
  if (['ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'EPIPE', 'ENOTFOUND'].includes(error?.code)) {
    return true;
  }

  const lower = errorText.toLowerCase();
  if (
    [
      'connection reset',
      'econnreset',
      'stream reading error',
      'broken pipe',
      'eof occurred',
      'read timeout',
      'socket hang up',
      'network error',
    ].some((token) => lower.includes(token))
  ) {
    return true;
  }

  return false;
}

// Gemini internal retries — server-side/transient failures only.
function isGeminiRetryable(error) {
  const statusCode = getStatusCode(error);
  if (statusCode && statusCode >= 500) return true;
  return shouldFallbackToGroq(error);
}

function wrapProviderError(provider, error) {
  const wrapped = new Error(`${provider} request failed: ${error.message}`);
  wrapped.provider = provider;
  wrapped.statusCode = getStatusCode(error);
  wrapped.cause = error;
  return wrapped;
}

module.exports = {
  shouldFallbackToGroq,
  isGeminiRetryable,
  wrapProviderError,
  getStatusCode,
};
