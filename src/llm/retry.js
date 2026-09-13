function sleep(attempt) {
  const delayMs = Math.min(8000, 2 ** attempt * 1000) + Math.random() * 500;
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

async function withRetries(fn, { maxRetries = 3, isRetryable = () => true } = {}) {
  let lastError;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn(attempt);
    } catch (error) {
      lastError = error;
      const canRetry = attempt < maxRetries - 1 && isRetryable(error);
      if (!canRetry) break;
      await sleep(attempt);
    }
  }

  throw lastError;
}

module.exports = { sleep, withRetries };
