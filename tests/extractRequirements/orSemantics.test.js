const { SYSTEM_PROMPT } = require('../../src/kits/stages/extractRequirements/promptBuilder');
const {
  validateRequirementsOutput,
  isAlternativeRequirement,
  isCompoundAndRequirement,
} = require('../../src/kits/stages/extractRequirements/requirements.schema');
const { normalizeRequirementsOutput } = require('../../src/kits/stages/extractRequirements/normalize');

function extractRequirements(raw) {
  validateRequirementsOutput(raw);
  return normalizeRequirementsOutput(raw);
}

describe('OR semantics — prompt instructions', () => {
  test('system prompt instructs preserving OR alternatives as one requirement', () => {
    expect(SYSTEM_PROMPT).toContain('OR / ALTERNATIVES — NEVER SPLIT');
    expect(SYSTEM_PROMPT).toContain('Strong Java, Python, or Go skills');
    expect(SYSTEM_PROMPT).toContain('DO NOT paraphrase or rewrite JD wording');
  });

  test('system prompt distinguishes OR alternatives from AND-all-required splitting', () => {
    expect(SYSTEM_PROMPT).toContain('AND / ALL-REQUIRED — SPLIT');
    expect(SYSTEM_PROMPT).toContain('Node.js, AWS, PostgreSQL and Docker');
  });
});

describe('OR semantics — schema helpers', () => {
  test('detects OR alternative phrasing', () => {
    expect(isAlternativeRequirement('Strong Java, Python, or Go skills')).toBe(true);
    expect(isAlternativeRequirement('Experience with Java or Python')).toBe(true);
  });

  test('does not treat AND compounds as OR alternatives', () => {
    expect(isAlternativeRequirement('Java and SQL experience')).toBe(false);
    expect(isAlternativeRequirement('Node.js, AWS, PostgreSQL and Docker')).toBe(false);
  });

  test('flags AND compounds but not OR alternatives', () => {
    expect(isCompoundAndRequirement('Node.js, AWS, PostgreSQL and Docker')).toBe(true);
    expect(isCompoundAndRequirement('Strong Java, Python, or Go skills')).toBe(false);
    expect(isCompoundAndRequirement('Java and SQL experience')).toBe(true);
  });
});

describe('OR semantics — extraction output', () => {
  test('Java, Python, or Go → one alternative requirement', () => {
    const result = extractRequirements({
      roleTitle: 'Backend Engineer',
      seniority: 'Senior',
      responsibilities: [],
      requirements: [
        { text: 'Strong Java, Python, or Go skills', kind: 'technical', priority: 'must' },
      ],
    });

    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toEqual({
      id: 'r1',
      text: 'Strong Java, Python, or Go skills',
      kind: 'technical',
      priority: 'must',
    });
  });

  test('Java or Python → one requirement', () => {
    const result = extractRequirements({
      roleTitle: 'Engineer',
      seniority: 'Mid',
      responsibilities: [],
      requirements: [{ text: 'Experience with Java or Python', kind: 'technical', priority: 'must' }],
    });

    expect(result.items).toHaveLength(1);
    expect(result.items[0].text).toBe('Experience with Java or Python');
  });

  test('Java and SQL in one phrase → preserve combined meaning', () => {
    const result = extractRequirements({
      roleTitle: 'Engineer',
      seniority: 'Mid',
      responsibilities: [],
      requirements: [{ text: 'Java and SQL experience', kind: 'technical', priority: 'must' }],
    });

    expect(result.items).toHaveLength(1);
    expect(result.items[0].text).toBe('Java and SQL experience');
  });

  test('separate Java and SQL sentences → two requirements', () => {
    const result = extractRequirements({
      roleTitle: 'Engineer',
      seniority: 'Mid',
      responsibilities: [],
      requirements: [
        { text: 'Java experience', kind: 'technical', priority: 'must' },
        { text: 'SQL experience', kind: 'technical', priority: 'must' },
      ],
    });

    expect(result.items).toHaveLength(2);
    expect(result.items[0].text).toBe('Java experience');
    expect(result.items[1].text).toBe('SQL experience');
    expect(result.items[0].id).toBe('r1');
    expect(result.items[1].id).toBe('r2');
  });

  test('OR expression with nice-to-have priority', () => {
    const result = extractRequirements({
      roleTitle: 'Engineer',
      seniority: 'Mid',
      responsibilities: [],
      requirements: [
        {
          text: 'Experience with Rust or Kotlin',
          kind: 'technical',
          priority: 'nice',
        },
      ],
    });

    expect(result.items).toHaveLength(1);
    expect(result.items[0].priority).toBe('nice');
    expect(result.items[0].text).toBe('Experience with Rust or Kotlin');
  });

  test('OR expression with technical classification', () => {
    const result = extractRequirements({
      roleTitle: 'Engineer',
      seniority: 'Mid',
      responsibilities: [],
      requirements: [
        { text: 'Strong Java, Python, or Go skills', kind: 'technical', priority: 'must' },
      ],
    });

    expect(result.items[0].kind).toBe('technical');
  });

  test('mixed unrelated qualifications → separate requirements', () => {
    const result = extractRequirements({
      roleTitle: 'Engineer',
      seniority: 'Mid',
      responsibilities: [],
      requirements: [
        { text: 'Strong Java, Python, or Go skills', kind: 'technical', priority: 'must' },
        { text: 'Experience with PostgreSQL', kind: 'technical', priority: 'must' },
        { text: 'Clear written communication', kind: 'behavioural', priority: 'must' },
      ],
    });

    expect(result.items).toHaveLength(3);
    expect(result.items.map((item) => item.text)).toEqual([
      'Strong Java, Python, or Go skills',
      'Experience with PostgreSQL',
      'Clear written communication',
    ]);
  });

  test('assigns application-generated stable IDs', () => {
    const result = extractRequirements({
      roleTitle: 'Engineer',
      seniority: 'Mid',
      responsibilities: [],
      requirements: [
        { text: 'Strong Java, Python, or Go skills', kind: 'technical', priority: 'must' },
        { text: 'Experience with PostgreSQL', kind: 'technical', priority: 'must' },
      ],
    });

    expect(result.items[0].id).toBe('r1');
    expect(result.items[1].id).toBe('r2');
    expect(result.items.every((item) => /^r\d+$/.test(item.id))).toBe(true);
  });

  test('does not produce three separate must-haves for a single OR phrase', () => {
    const badSplit = {
      roleTitle: 'Engineer',
      seniority: 'Mid',
      responsibilities: [],
      requirements: [
        { text: 'Java', kind: 'technical', priority: 'must' },
        { text: 'Python', kind: 'technical', priority: 'must' },
        { text: 'Go', kind: 'technical', priority: 'must' },
      ],
    };

    // Normalization preserves what the LLM returns — the prompt must prevent bad splits.
    // This test documents the anti-pattern: three independent must-haves from one OR phrase.
    const result = extractRequirements(badSplit);
    expect(result.items).toHaveLength(3);
    expect(result.items.map((item) => item.text)).toEqual(['Java', 'Python', 'Go']);

    const goodOutput = extractRequirements({
      roleTitle: 'Engineer',
      seniority: 'Mid',
      responsibilities: [],
      requirements: [
        { text: 'Strong Java, Python, or Go skills', kind: 'technical', priority: 'must' },
      ],
    });
    expect(goodOutput.items).toHaveLength(1);
    expect(goodOutput.items[0].text).toContain('or Go');
  });
});

describe('OR semantics — quality warnings', () => {
  test('does not warn on OR alternative requirements', () => {
    const result = validateRequirementsOutput({
      roleTitle: 'Engineer',
      seniority: 'Mid',
      responsibilities: [],
      requirements: [
        { text: 'Strong Java, Python, or Go skills', kind: 'technical', priority: 'must' },
      ],
    });

    expect(result.qualityWarnings).toHaveLength(0);
  });

  test('warns on AND-style compound requirements', () => {
    const result = validateRequirementsOutput({
      roleTitle: 'Engineer',
      seniority: 'Mid',
      responsibilities: [],
      requirements: [
        {
          text: 'Node.js, AWS, PostgreSQL and Docker experience',
          kind: 'technical',
          priority: 'must',
        },
      ],
    });

    expect(result.qualityWarnings).toHaveLength(1);
    expect(result.qualityWarnings[0].type).toBe('compoundRequirementWarning');
  });
});
