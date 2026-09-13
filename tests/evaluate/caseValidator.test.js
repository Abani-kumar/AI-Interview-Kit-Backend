const { validateCase } = require('../../src/evaluate/caseValidator');
const { ERROR_CODES } = require('../../src/evaluate/errors');

describe('validateCase', () => {
  test('accepts a valid case with company_url', () => {
    const result = validateCase(
      {
        id: 'case-1',
        jd: 'Backend engineer role',
        company_url: 'https://example.com',
        days: 5,
      },
      0
    );

    expect(result.isValid).toBe(true);
    expect(result.normalized).toEqual({
      id: 'case-1',
      jd: 'Backend engineer role',
      companyUrl: 'https://example.com',
      days: 5,
    });
  });

  test('accepts companyUrl alias', () => {
    const result = validateCase(
      {
        id: 'case-2',
        jd: 'Frontend role',
        companyUrl: 'https://example.com',
        days: 10,
      },
      1
    );

    expect(result.isValid).toBe(true);
    expect(result.normalized.companyUrl).toBe('https://example.com');
  });

  test('rejects malformed case object', () => {
    const result = validateCase(null, 0);
    expect(result.isValid).toBe(false);
    expect(result.error.code).toBe(ERROR_CODES.INVALID_INPUT);
  });

  test('rejects missing id', () => {
    const result = validateCase({ jd: 'x', company_url: 'https://a.com', days: 5 }, 0);
    expect(result.isValid).toBe(false);
    expect(result.error.message).toMatch(/missing a non-empty "id"/);
  });

  test('rejects invalid days', () => {
    const result = validateCase(
      { id: 'case-3', jd: 'x', company_url: 'https://a.com', days: 0 },
      0
    );
    expect(result.isValid).toBe(false);
    expect(result.error.message).toMatch(/positive integer "days"/);
  });
});
