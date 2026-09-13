const { parseEvaluateArgs } = require('../../src/evaluate/parseArgs');

describe('parseEvaluateArgs', () => {
  test('parses valid input and output flags', () => {
    const result = parseEvaluateArgs(['--input', 'cases.json', '--output', 'kits.json']);
    expect(result.isValid).toBe(true);
    expect(result.input).toBe('cases.json');
    expect(result.output).toBe('kits.json');
  });

  test('reports missing --input', () => {
    const result = parseEvaluateArgs(['--output', 'kits.json']);
    expect(result.isValid).toBe(false);
    expect(result.errors).toContain('Missing required flag: --input <path>');
  });

  test('reports missing --output', () => {
    const result = parseEvaluateArgs(['--input', 'cases.json']);
    expect(result.isValid).toBe(false);
    expect(result.errors).toContain('Missing required flag: --output <path>');
  });
});
