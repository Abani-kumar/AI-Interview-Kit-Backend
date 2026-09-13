const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { loadCases } = require('../../src/evaluate/loadCases');

describe('loadCases', () => {
  let tempDir;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'evaluate-load-'));
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  test('loads a valid cases array', async () => {
    const filePath = path.join(tempDir, 'cases.json');
    await fs.writeFile(filePath, JSON.stringify([{ id: 'case-1' }]));

    const cases = await loadCases(filePath);
    expect(cases).toEqual([{ id: 'case-1' }]);
  });

  test('throws when input file is missing', async () => {
    await expect(loadCases(path.join(tempDir, 'missing.json'))).rejects.toThrow(
      'Input file not found'
    );
  });

  test('throws for invalid JSON with a helpful message', async () => {
    const filePath = path.join(tempDir, 'bad.json');
    await fs.writeFile(filePath, '{not-json');

    await expect(loadCases(filePath)).rejects.toThrow('Input file is not valid JSON');
    await expect(loadCases(filePath)).rejects.toThrow('jd_file');
  });

  test('loads cases with literal newlines in jd strings', async () => {
    const filePath = path.join(tempDir, 'cases.json');
    await fs.writeFile(
      filePath,
      `[
  {
    "id": "case-1",
    "jd": "Backend Engineer

Requirements:
- Node.js",
    "company_url": "https://example.com",
    "days": 5
  }
]`
    );

    const cases = await loadCases(filePath);
    expect(cases[0].jd).toBe('Backend Engineer\n\nRequirements:\n- Node.js');
  });

  test('loads jd from jd_file relative to the input file', async () => {
    const jdPath = path.join(tempDir, 'case-1.jd.txt');
    await fs.writeFile(jdPath, 'Backend Engineer\n\nRequirements:\n- Node.js');

    const filePath = path.join(tempDir, 'cases.json');
    await fs.writeFile(
      filePath,
      JSON.stringify([
        {
          id: 'case-1',
          jd_file: 'case-1.jd.txt',
          company_url: 'https://example.com',
          days: 5,
        },
      ])
    );

    const cases = await loadCases(filePath);
    expect(cases[0].jd).toBe('Backend Engineer\n\nRequirements:\n- Node.js');
  });

  test('throws when input is not an array', async () => {
    const filePath = path.join(tempDir, 'object.json');
    await fs.writeFile(filePath, JSON.stringify({ id: 'case-1' }));

    await expect(loadCases(filePath)).rejects.toThrow('Input JSON must be an array of cases');
  });
});
