const {
  validateRequirementsOutput,
  VALID_KINDS,
  VALID_PRIORITIES,
} = require('../../src/kits/stages/extractRequirements/requirements.schema');

function validOutput(overrides = {}) {
  return {
    roleTitle: 'Backend Engineer',
    seniority: 'Senior',
    responsibilities: ['Build APIs'],
    requirements: [
      { text: 'Node.js experience', kind: 'technical', priority: 'must' },
      { text: 'Clear communication', kind: 'behavioural', priority: 'nice' },
    ],
    ...overrides,
  };
}

describe('validateRequirementsOutput', () => {
  test('accepts the required structure', () => {
    const result = validateRequirementsOutput(validOutput());
    expect(result.valid).toBe(true);
    expect(result.qualityWarnings).toEqual([]);
  });

  test.each(VALID_KINDS)('accepts kind "%s"', (kind) => {
    const output = validOutput({
      requirements: [{ text: 'Requirement', kind, priority: 'must' }],
    });
    expect(() => validateRequirementsOutput(output)).not.toThrow();
  });

  test.each(VALID_PRIORITIES)('accepts priority "%s"', (priority) => {
    const output = validOutput({
      requirements: [{ text: 'Requirement', kind: 'technical', priority }],
    });
    expect(() => validateRequirementsOutput(output)).not.toThrow();
  });

  test('rejects non-object output', () => {
    expect(() => validateRequirementsOutput(null)).toThrow('must be a JSON object');
    expect(() => validateRequirementsOutput([])).toThrow('must be a JSON object');
  });

  test('rejects missing top-level keys', () => {
    expect(() => validateRequirementsOutput({ roleTitle: 'x' })).toThrow(
      'LLM output missing required key:'
    );
  });

  test('rejects invalid kind', () => {
    const output = validOutput({
      requirements: [{ text: 'x', kind: 'invalid', priority: 'must' }],
    });
    expect(() => validateRequirementsOutput(output)).toThrow('kind "invalid" is invalid');
  });

  test('rejects invalid priority', () => {
    const output = validOutput({
      requirements: [{ text: 'x', kind: 'technical', priority: 'optional' }],
    });
    expect(() => validateRequirementsOutput(output)).toThrow('priority "optional" is invalid');
  });

  test('rejects empty requirement text', () => {
    const output = validOutput({
      requirements: [{ text: '   ', kind: 'technical', priority: 'must' }],
    });
    expect(() => validateRequirementsOutput(output)).toThrow('text must be a non-empty string');
  });

  test('accepts thin JD output with few requirements', () => {
    const output = validOutput({ requirements: [{ text: 'Java', kind: 'technical', priority: 'must' }] });
    const result = validateRequirementsOutput(output);
    expect(result.valid).toBe(true);
  });

  test('does not warn on OR-style alternative requirements', () => {
    const output = validOutput({
      requirements: [
        {
          text: 'Strong Java, Python, or Go skills',
          kind: 'technical',
          priority: 'must',
        },
      ],
    });

    const result = validateRequirementsOutput(output);
    expect(result.valid).toBe(true);
    expect(result.qualityWarnings).toHaveLength(0);
  });

  test('warns on AND-style compound requirements', () => {
    const output = validOutput({
      requirements: [
        {
          text: 'Node.js, AWS, PostgreSQL and Docker experience',
          kind: 'technical',
          priority: 'must',
        },
      ],
    });

    const result = validateRequirementsOutput(output);
    expect(result.valid).toBe(true);
    expect(result.qualityWarnings).toHaveLength(1);
    expect(result.qualityWarnings[0].type).toBe('compoundRequirementWarning');
  });

  test('rejects malformed requirements array', () => {
    const output = validOutput({ requirements: 'not-an-array' });
    expect(() => validateRequirementsOutput(output)).toThrow('"requirements" must be an array');
  });
});
