const {
  findInvalidRequirementRefs,
  countQuestionsByRequirement,
  computeUncoveredMustHaves,
} = require('../src/kits/stages/checkCoverage/coverageCalculator');

// ─── findInvalidRequirementRefs ───────────────────────────────────────────────

describe('findInvalidRequirementRefs', () => {
  const knownIds = new Set(['r1', 'r2', 'r3']);

  test('returns empty array when all refs are valid', () => {
    const questions = [
      { id: 'q1', requirement_ids: ['r1', 'r2'] },
      { id: 'q2', requirement_ids: ['r3'] },
    ];
    expect(findInvalidRequirementRefs(questions, knownIds)).toEqual([]);
  });

  test('returns invalid ref entries', () => {
    const questions = [{ id: 'q1', requirement_ids: ['r1', 'r_fake'] }];
    const result = findInvalidRequirementRefs(questions, knownIds);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ questionId: 'q1', invalidRef: 'r_fake' });
  });

  test('handles questions with empty requirement_ids', () => {
    const questions = [{ id: 'q1', requirement_ids: [] }];
    expect(findInvalidRequirementRefs(questions, knownIds)).toEqual([]);
  });

  test('handles empty questions array', () => {
    expect(findInvalidRequirementRefs([], knownIds)).toEqual([]);
  });
});

// ─── countQuestionsByRequirement ─────────────────────────────────────────────

describe('countQuestionsByRequirement', () => {
  test('counts correctly for single-requirement questions', () => {
    const questions = [
      { id: 'q1', requirement_ids: ['r1'] },
      { id: 'q2', requirement_ids: ['r1'] },
      { id: 'q3', requirement_ids: ['r2'] },
    ];
    const counts = countQuestionsByRequirement(questions);
    expect(counts.get('r1')).toBe(2);
    expect(counts.get('r2')).toBe(1);
    expect(counts.get('r3')).toBeUndefined();
  });

  test('counts correctly for multi-requirement questions', () => {
    const questions = [{ id: 'q1', requirement_ids: ['r1', 'r2', 'r3'] }];
    const counts = countQuestionsByRequirement(questions);
    expect(counts.get('r1')).toBe(1);
    expect(counts.get('r2')).toBe(1);
    expect(counts.get('r3')).toBe(1);
  });

  test('returns empty map for empty questions', () => {
    const counts = countQuestionsByRequirement([]);
    expect(counts.size).toBe(0);
  });
});

// ─── computeUncoveredMustHaves ────────────────────────────────────────────────

describe('computeUncoveredMustHaves', () => {
  // Use MIN_QUESTIONS_PER_MUST_REQUIREMENT=1 (default in test env)
  const requirements = [
    { id: 'r1', priority: 'must' },
    { id: 'r2', priority: 'must' },
    { id: 'r3', priority: 'nice' },
  ];

  test('returns empty when all must-haves are covered', () => {
    const counts = new Map([['r1', 1], ['r2', 2]]);
    expect(computeUncoveredMustHaves(requirements, counts)).toEqual([]);
  });

  test('returns uncovered must-have IDs', () => {
    const counts = new Map([['r1', 1]]);
    const result = computeUncoveredMustHaves(requirements, counts);
    expect(result).toContain('r2');
    expect(result).not.toContain('r1');
  });

  test('ignores nice requirements even when uncovered', () => {
    const counts = new Map([['r1', 1], ['r2', 1]]); // r3 not covered
    const result = computeUncoveredMustHaves(requirements, counts);
    expect(result).not.toContain('r3');
  });

  test('returns all must-haves when questions array is empty', () => {
    const result = computeUncoveredMustHaves(requirements, new Map());
    expect(result).toContain('r1');
    expect(result).toContain('r2');
    expect(result).not.toContain('r3');
  });

  test('multiple questions covering same requirement counts correctly', () => {
    // With MIN=1, having 3 questions for r1 still = covered
    const counts = new Map([['r1', 3], ['r2', 1]]);
    expect(computeUncoveredMustHaves(requirements, counts)).toEqual([]);
  });

  test('a question with multiple requirement_ids covers all of them', () => {
    // q1 → [r1, r2] means both r1 and r2 have count=1
    const counts = new Map([['r1', 1], ['r2', 1]]);
    expect(computeUncoveredMustHaves(requirements, counts)).toEqual([]);
  });
});

// ─── stage handler (integration-style with mocks) ────────────────────────────

jest.mock('../src/models/Kit');

describe('checkCoverage stage handler', () => {
  const requirements = [
    { id: 'r1', text: 'Node.js', priority: 'must' },
    { id: 'r2', text: 'AWS', priority: 'must' },
    { id: 'r3', text: 'Nice to have', priority: 'nice' },
  ];

  const buildKit = (overrides = {}) => ({
    results: {
      coveragePass: 0,
      requirements: { items: requirements },
      questions: [],
      coverage: null,
      ...overrides,
    },
  });

  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetModules();
    delete process.env.MAX_COVERAGE_PASSES;
  });

  test('returns generate-flashcards when all must-haves are covered', async () => {
    const Kit = require('../src/models/Kit');
    const kit = buildKit({
      questions: [
        { id: 'q1', requirement_ids: ['r1'] },
        { id: 'q2', requirement_ids: ['r2'] },
      ],
    });
    Kit.findById.mockReturnValue({ lean: () => Promise.resolve(kit) });
    Kit.findByIdAndUpdate.mockResolvedValue({});

    const checkCoverage = require('../src/kits/stages/checkCoverage');
    const result = await checkCoverage('kit123');

    expect(result).toEqual({ next: 'generate-flashcards' });
    expect(Kit.findByIdAndUpdate).toHaveBeenCalledWith(
      'kit123',
      expect.objectContaining({
        'results.coverage': expect.objectContaining({ uncovered_requirement_ids: [] }),
      })
    );
  });

  test('returns generate-questions when must-haves are uncovered', async () => {
    const Kit = require('../src/models/Kit');
    const kit = buildKit({
      questions: [{ id: 'q1', requirement_ids: ['r1'] }], // r2 uncovered
    });
    Kit.findById.mockReturnValue({ lean: () => Promise.resolve(kit) });
    Kit.findByIdAndUpdate.mockResolvedValue({});

    const checkCoverage = require('../src/kits/stages/checkCoverage');
    const result = await checkCoverage('kit123');

    expect(result).toEqual({ next: 'generate-questions' });
    expect(Kit.findByIdAndUpdate).toHaveBeenCalledWith(
      'kit123',
      expect.objectContaining({
        'results.coverage': expect.objectContaining({
          uncovered_requirement_ids: ['r2'],
        }),
        'results.coveragePass': 1,
        'stages.generate-questions.status': 'pending',
      })
    );
  });

  test('ignores nice requirements when checking coverage', async () => {
    const Kit = require('../src/models/Kit');
    const kit = buildKit({
      questions: [
        { id: 'q1', requirement_ids: ['r1'] },
        { id: 'q2', requirement_ids: ['r2'] },
        // r3 (nice) deliberately uncovered
      ],
    });
    Kit.findById.mockReturnValue({ lean: () => Promise.resolve(kit) });
    Kit.findByIdAndUpdate.mockResolvedValue({});

    const checkCoverage = require('../src/kits/stages/checkCoverage');
    const result = await checkCoverage('kit123');
    expect(result).toEqual({ next: 'generate-flashcards' });
  });

  test('increments passes counter on each loop', async () => {
    const Kit = require('../src/models/Kit');
    const kit = buildKit({
      questions: [], // r1, r2 both uncovered
      coveragePass: 1,
    });
    Kit.findById.mockReturnValue({ lean: () => Promise.resolve(kit) });
    Kit.findByIdAndUpdate.mockResolvedValue({});

    const checkCoverage = require('../src/kits/stages/checkCoverage');
    await checkCoverage('kit123');

    expect(Kit.findByIdAndUpdate).toHaveBeenCalledWith(
      'kit123',
      expect.objectContaining({
        'results.coverage': expect.objectContaining({ passes: 2 }),
        'results.coveragePass': 2,
      })
    );
  });

  test('throws when max passes reached with uncovered musts', async () => {
    process.env.MAX_COVERAGE_PASSES = '2';

    const Kit = require('../src/models/Kit');
    Kit.findById.mockReturnValue({
      lean: () =>
        Promise.resolve(
          buildKit({
            questions: [], // r1, r2 both uncovered
            coveragePass: 2, // = MAX_COVERAGE_PASSES, so we're at the limit
          })
        ),
    });
    Kit.findByIdAndUpdate.mockResolvedValue({});

    const checkCoverage = require('../src/kits/stages/checkCoverage');
    await expect(checkCoverage('kit123')).rejects.toThrow(
      'Coverage check exhausted 2 pass(es)'
    );
  });

  test('throws when question references invalid requirement ID', async () => {
    const Kit = require('../src/models/Kit');
    const kit = buildKit({
      questions: [{ id: 'q1', requirement_ids: ['r_invented'] }],
    });
    Kit.findById.mockReturnValue({ lean: () => Promise.resolve(kit) });

    const checkCoverage = require('../src/kits/stages/checkCoverage');
    await expect(checkCoverage('kit123')).rejects.toThrow('invalid requirement_ids');
  });

  test('one question with multiple requirement_ids covers all referenced musts', async () => {
    const Kit = require('../src/models/Kit');
    const kit = buildKit({
      questions: [{ id: 'q1', requirement_ids: ['r1', 'r2'] }],
    });
    Kit.findById.mockReturnValue({ lean: () => Promise.resolve(kit) });
    Kit.findByIdAndUpdate.mockResolvedValue({});

    const checkCoverage = require('../src/kits/stages/checkCoverage');
    const result = await checkCoverage('kit123');
    expect(result).toEqual({ next: 'generate-flashcards' });
  });

  test('deleted requirement IDs in questions fail structural validation', async () => {
    const Kit = require('../src/models/Kit');
    const kit = buildKit({
      questions: [{ id: 'q1', requirement_ids: ['r_deleted'] }],
    });
    Kit.findById.mockReturnValue({ lean: () => Promise.resolve(kit) });

    const checkCoverage = require('../src/kits/stages/checkCoverage');
    await expect(checkCoverage('kit123')).rejects.toThrow('invalid requirement_ids');
  });

  test('multiple questions covering same requirement still counts as covered', async () => {
    const Kit = require('../src/models/Kit');
    const kit = buildKit({
      questions: [
        { id: 'q1', requirement_ids: ['r1'] },
        { id: 'q2', requirement_ids: ['r1'] },
        { id: 'q3', requirement_ids: ['r2'] },
      ],
    });
    Kit.findById.mockReturnValue({ lean: () => Promise.resolve(kit) });
    Kit.findByIdAndUpdate.mockResolvedValue({});

    const checkCoverage = require('../src/kits/stages/checkCoverage');
    const result = await checkCoverage('kit123');
    expect(result).toEqual({ next: 'generate-flashcards' });
  });
});
