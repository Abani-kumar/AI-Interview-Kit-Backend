const ERROR_CODES = {
  INVALID_INPUT: 'INVALID_INPUT',
  ENQUEUE_FAILED: 'ENQUEUE_FAILED',
  GENERATION_FAILED: 'GENERATION_FAILED',
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  TIMEOUT: 'TIMEOUT',
};

function buildError(code, message) {
  return {
    code,
    message: sanitizeMessage(message),
  };
}

function sanitizeMessage(message) {
  if (!message) return 'Unknown error';

  const text = String(message).split('\n')[0].trim();
  if (!text) return 'Unknown error';

  // Avoid leaking env-style secrets in error output.
  return text
    .replace(/(api[_-]?key|token|password|secret)\s*[:=]\s*\S+/gi, '$1=[redacted]')
    .slice(0, 500);
}

module.exports = { ERROR_CODES, buildError, sanitizeMessage };
