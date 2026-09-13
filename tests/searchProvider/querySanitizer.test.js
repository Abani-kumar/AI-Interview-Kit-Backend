const { sanitizeSearchQueries, validateSearchQuery } = require('../../src/searchProvider/querySanitizer');

describe('querySanitizer', () => {
  test('trims whitespace and collapses internal spaces', () => {
    const result = sanitizeSearchQueries(['  Acme   interview   process  '], 3);
    expect(result.queries).toEqual(['Acme interview process']);
    expect(result.skipped).toHaveLength(0);
  });

  test('discards empty queries', () => {
    const result = sanitizeSearchQueries(['', '   ', null, 'Acme interview'], 3);
    expect(result.queries).toEqual(['Acme interview']);
    expect(result.skipped).toHaveLength(3);
    expect(result.skipped[0].reason).toBe('empty query');
  });

  test('deduplicates equivalent queries case-insensitively', () => {
    const result = sanitizeSearchQueries(
      ['Acme interview', 'acme interview', 'Acme Interview Questions'],
      3
    );
    expect(result.queries).toEqual(['Acme interview', 'Acme Interview Questions']);
    expect(result.skipped.some((entry) => entry.reason === 'duplicate query')).toBe(true);
  });

  test('enforces query-count limit', () => {
    const result = sanitizeSearchQueries(
      ['q1', 'q2', 'q3', 'q4'],
      3
    );
    expect(result.queries).toHaveLength(3);
    expect(result.skipped.some((entry) => entry.reason === 'query limit reached')).toBe(true);
  });

  test('limits overly long queries to provider constraints', () => {
    const longQuery = `${'word '.repeat(60)}interview`;
    const validation = validateSearchQuery(longQuery);
    expect(validation.valid).toBe(true);
    expect(validation.query.split(/\s+/)).toHaveLength(50);
  });
});
