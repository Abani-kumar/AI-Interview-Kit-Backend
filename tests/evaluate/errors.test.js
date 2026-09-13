const { buildError, sanitizeMessage, ERROR_CODES } = require('../../src/evaluate/errors');

describe('evaluate errors', () => {
  test('buildError returns structured code and message', () => {
    expect(buildError(ERROR_CODES.INVALID_INPUT, 'Bad case')).toEqual({
      code: 'INVALID_INPUT',
      message: 'Bad case',
    });
  });

  test('sanitizeMessage redacts secrets from error text', () => {
    const sanitized = sanitizeMessage('Auth failed: api_key=super-secret-token-value');
    expect(sanitized).toContain('api_key=[redacted]');
    expect(sanitized).not.toContain('super-secret-token-value');
  });

  test('sanitizeMessage keeps only the first line', () => {
    expect(sanitizeMessage('First line\nstack trace here')).toBe('First line');
  });
});
