const { parseCasesJson, escapeNewlinesInJsonStrings } = require('../../src/evaluate/parseCasesJson');

describe('parseCasesJson', () => {
  test('parses standard JSON', () => {
    const parsed = parseCasesJson('[{"id":"case-1","jd":"Backend role"}]');
    expect(parsed).toEqual([{ id: 'case-1', jd: 'Backend role' }]);
  });

  test('parses JSON with escaped newlines', () => {
    const parsed = parseCasesJson('[{"id":"case-1","jd":"line1\\n\\nline2"}]');
    expect(parsed[0].jd).toBe('line1\n\nline2');
  });

  test('repairs JSON with literal newlines inside strings', () => {
    const raw = `[
  {
    "id": "case-1",
    "jd": "Backend Engineer

Requirements:
- Node.js",
    "company_url": "https://example.com",
    "days": 5
  }
]`;

    const parsed = parseCasesJson(raw);
    expect(parsed[0].jd).toBe('Backend Engineer\n\nRequirements:\n- Node.js');
  });

  test('throws a helpful error for invalid JSON', () => {
    expect(() => parseCasesJson('{not-json')).toThrow('Input file is not valid JSON');
    expect(() => parseCasesJson('{not-json')).toThrow('jd_file');
  });
});

describe('escapeNewlinesInJsonStrings', () => {
  test('escapes tabs inside strings only', () => {
    const repaired = escapeNewlinesInJsonStrings('{"jd":"a\tb"}');
    expect(repaired).toBe('{"jd":"a\\tb"}');
  });
});
