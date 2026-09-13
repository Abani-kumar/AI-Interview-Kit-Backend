const {
  normalizeText,
  deduplicateRequirements,
  assignRequirementIds,
  normalizeRequirementsOutput,
} = require('../../src/kits/stages/extractRequirements/normalize');

describe('normalizeText', () => {
  test('trims, collapses whitespace, and removes trailing period', () => {
    expect(normalizeText('  Node.js   experience.  ')).toBe('Node.js experience');
  });
});

describe('deduplicateRequirements', () => {
  test('removes exact duplicates case-insensitively', () => {
    const input = [
      { text: 'Node.js', kind: 'technical', priority: 'must' },
      { text: 'node.js', kind: 'technical', priority: 'must' },
      { text: 'AWS', kind: 'technical', priority: 'must' },
    ];
    expect(deduplicateRequirements(input)).toHaveLength(2);
  });

  test('preserves near-duplicates as separate entries', () => {
    const input = [
      { text: 'Node.js experience', kind: 'technical', priority: 'must' },
      { text: 'Experience with Node.js', kind: 'technical', priority: 'must' },
    ];
    expect(deduplicateRequirements(input)).toHaveLength(2);
  });
});

describe('assignRequirementIds', () => {
  test('assigns stable sequential IDs r1..rN', () => {
    const withIds = assignRequirementIds([
      { text: 'A', kind: 'technical', priority: 'must' },
      { text: 'B', kind: 'domain', priority: 'nice' },
    ]);

    expect(withIds).toEqual([
      { id: 'r1', text: 'A', kind: 'technical', priority: 'must' },
      { id: 'r2', text: 'B', kind: 'domain', priority: 'nice' },
    ]);
  });
});

describe('normalizeRequirementsOutput', () => {
  test('normalizes responsibilities and assigns IDs to requirements', () => {
    const normalized = normalizeRequirementsOutput({
      roleTitle: '  Backend Engineer. ',
      seniority: ' Senior ',
      responsibilities: ['  Build APIs. '],
      requirements: [
        { text: 'Node.js. ', kind: 'technical', priority: 'must' },
        { text: 'node.js', kind: 'technical', priority: 'must' },
      ],
    });

    expect(normalized.roleTitle).toBe('Backend Engineer');
    expect(normalized.seniority).toBe('Senior');
    expect(normalized.responsibilities).toEqual(['Build APIs']);
    expect(normalized.items).toHaveLength(1);
    expect(normalized.items[0].id).toBe('r1');
  });

  test('preserves OR-semantics requirement as a single atomic entry', () => {
    const normalized = normalizeRequirementsOutput({
      roleTitle: 'Engineer',
      seniority: 'Mid',
      responsibilities: [],
      requirements: [
        {
          text: 'Strong Java, Python, or Go skills',
          kind: 'technical',
          priority: 'must',
        },
      ],
    });

    expect(normalized.items).toHaveLength(1);
    expect(normalized.items[0].text).toBe('Strong Java, Python, or Go skills');
  });
});
