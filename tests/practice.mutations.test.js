jest.mock('../src/models/Kit');

const Kit = require('../src/models/Kit');
const {
  recordPracticeAttempt,
  getPracticeSummary,
  buildPracticeSummary,
  buildRequirementAnalytics,
  latestAttemptByFlashcard,
  IDEMPOTENCY_WINDOW_MS,
} = require('../src/kits/practice.mutations');

function baseKit(overrides = {}) {
  const { results: resultsOverrides = {}, practice: practiceOverrides = {}, ...rest } = overrides;

  return {
    _id: 'kit123',
    userId: 'user1',
    status: 'ready',
    results: {
      requirements: {
        items: [
          { id: 'r1', text: 'Node.js', kind: 'technical', priority: 'must' },
          { id: 'r2', text: 'Communication', kind: 'behavioural', priority: 'nice' },
          { id: 'r4', text: 'System design', kind: 'technical', priority: 'must' },
        ],
      },
      flashcards: [
        {
          id: 'f1',
          front: 'Event loop',
          back: 'Async I/O',
          requirement_ids: ['r1'],
        },
        {
          id: 'f2',
          front: 'STAR',
          back: 'Behavioural framework',
          requirement_ids: ['r2'],
        },
        {
          id: 'f3',
          front: 'CAP theorem',
          back: 'Consistency, availability, partition tolerance',
          requirement_ids: ['r4'],
        },
      ],
      ...resultsOverrides,
    },
    practice: {
      attempts: [],
      ...practiceOverrides,
    },
    ...rest,
  };
}

function mockFindById(kit) {
  Kit.findById.mockImplementation(() => ({
    lean: () => Promise.resolve(kit),
  }));
}

function mockUpdate(updatedKit) {
  Kit.findByIdAndUpdate.mockImplementation(() => ({
    lean: () => Promise.resolve(updatedKit),
  }));
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('latestAttemptByFlashcard', () => {
  test('keeps the most recent attempt per flashcard', () => {
    const latest = latestAttemptByFlashcard([
      { flashcardId: 'f1', confidence: 'low', practicedAt: '2026-01-01T00:00:00.000Z' },
      { flashcardId: 'f1', confidence: 'medium', practicedAt: '2026-01-03T00:00:00.000Z' },
      { flashcardId: 'f2', confidence: 'high', practicedAt: '2026-01-02T00:00:00.000Z' },
    ]);

    expect(latest.get('f1').confidence).toBe('medium');
    expect(latest.get('f2').confidence).toBe('high');
  });
});

describe('requirement analytics', () => {
  const requirementItems = [
    { id: 'r1', text: 'Node.js' },
    { id: 'r2', text: 'Communication' },
    { id: 'r4', text: 'System design' },
  ];

  test('1. multiple attempts for one flashcard uses latest only', () => {
    const flashcards = [{ id: 'f1', requirement_ids: ['r1'] }];
    const latest = latestAttemptByFlashcard([
      { flashcardId: 'f1', confidence: 'low', practicedAt: '2026-01-01T00:00:00.000Z' },
      { flashcardId: 'f1', confidence: 'high', practicedAt: '2026-01-05T00:00:00.000Z' },
    ]);

    const analytics = buildRequirementAnalytics(flashcards, latest, requirementItems);

    expect(analytics[0]).toEqual({
      requirementId: 'r1',
      flashcardCount: 1,
      practicedFlashcardCount: 1,
      lowCount: 0,
      mediumCount: 0,
      highCount: 1,
      strengthPercent: 100,
      weaknessPercent: 0,
    });
  });

  test('2. multiple requirement_ids contribute to each linked requirement', () => {
    const flashcards = [{ id: 'f1', requirement_ids: ['r1', 'r2'] }];
    const latest = latestAttemptByFlashcard([
      { flashcardId: 'f1', confidence: 'medium', practicedAt: '2026-01-01T00:00:00.000Z' },
    ]);

    const analytics = buildRequirementAnalytics(flashcards, latest, requirementItems);

    expect(analytics[0]).toMatchObject({
      requirementId: 'r1',
      flashcardCount: 1,
      practicedFlashcardCount: 1,
      mediumCount: 1,
      strengthPercent: 50,
      weaknessPercent: 50,
    });
    expect(analytics[1]).toMatchObject({
      requirementId: 'r2',
      flashcardCount: 1,
      practicedFlashcardCount: 1,
      mediumCount: 1,
      strengthPercent: 50,
      weaknessPercent: 50,
    });
  });

  test('3. unpracticed flashcards are not treated as low confidence', () => {
    const flashcards = [
      { id: 'f1', requirement_ids: ['r1'] },
      { id: 'f2', requirement_ids: ['r1'] },
    ];
    const latest = latestAttemptByFlashcard([
      { flashcardId: 'f1', confidence: 'high', practicedAt: '2026-01-01T00:00:00.000Z' },
    ]);

    const analytics = buildRequirementAnalytics(flashcards, latest, requirementItems);

    expect(analytics[0]).toEqual({
      requirementId: 'r1',
      flashcardCount: 2,
      practicedFlashcardCount: 1,
      lowCount: 0,
      mediumCount: 0,
      highCount: 1,
      strengthPercent: 100,
      weaknessPercent: 0,
    });
  });

  test('4. custom flashcards with empty requirement_ids skip requirement analytics', () => {
    const kit = baseKit({
      results: {
        flashcards: [
          { id: 'f1', requirement_ids: ['r1'] },
          { id: 'f-custom', front: 'Custom', back: 'Note', requirement_ids: [] },
        ],
      },
      practice: {
        attempts: [
          { flashcardId: 'f1', confidence: 'high', practicedAt: '2026-01-01T00:00:00.000Z' },
          { flashcardId: 'f-custom', confidence: 'low', practicedAt: '2026-01-02T00:00:00.000Z' },
        ],
      },
    });

    const summary = buildPracticeSummary(kit);

    expect(summary.totalFlashcards).toBe(2);
    expect(summary.practicedFlashcards).toBe(2);
    expect(summary.lowConfidenceCount).toBe(1);
    expect(summary.requirements.find((item) => item.requirementId === 'r1')).toEqual({
      requirementId: 'r1',
      flashcardCount: 1,
      practicedFlashcardCount: 1,
      lowCount: 0,
      mediumCount: 0,
      highCount: 1,
      strengthPercent: 100,
      weaknessPercent: 0,
    });
    expect(summary.requirements.find((item) => item.requirementId === 'r2').flashcardCount).toBe(0);
  });

  test('5. deleted or detached requirement IDs are ignored', () => {
    const flashcards = [
      { id: 'f1', requirement_ids: ['r1', 'r-deleted'] },
      { id: 'f2', requirement_ids: ['r-orphan'] },
    ];
    const latest = latestAttemptByFlashcard([
      { flashcardId: 'f1', confidence: 'low', practicedAt: '2026-01-01T00:00:00.000Z' },
      { flashcardId: 'f2', confidence: 'low', practicedAt: '2026-01-02T00:00:00.000Z' },
    ]);

    const analytics = buildRequirementAnalytics(flashcards, latest, requirementItems);

    expect(analytics.map((item) => item.requirementId)).toEqual(['r1', 'r2', 'r4']);
    expect(analytics[0]).toMatchObject({
      requirementId: 'r1',
      flashcardCount: 1,
      practicedFlashcardCount: 1,
      lowCount: 1,
      strengthPercent: 0,
      weaknessPercent: 100,
    });
    expect(analytics[1].flashcardCount).toBe(0);
    expect(analytics[2].flashcardCount).toBe(0);
  });

  test('6. all-high confidence requirement analytics', () => {
    const flashcards = [
      { id: 'f1', requirement_ids: ['r1'] },
      { id: 'f2', requirement_ids: ['r1'] },
    ];
    const latest = latestAttemptByFlashcard([
      { flashcardId: 'f1', confidence: 'high', practicedAt: '2026-01-01T00:00:00.000Z' },
      { flashcardId: 'f2', confidence: 'high', practicedAt: '2026-01-02T00:00:00.000Z' },
    ]);

    const analytics = buildRequirementAnalytics(flashcards, latest, requirementItems);

    expect(analytics[0]).toEqual({
      requirementId: 'r1',
      flashcardCount: 2,
      practicedFlashcardCount: 2,
      lowCount: 0,
      mediumCount: 0,
      highCount: 2,
      strengthPercent: 100,
      weaknessPercent: 0,
    });
  });

  test('7. all-low confidence requirement analytics', () => {
    const flashcards = [
      { id: 'f1', requirement_ids: ['r2'] },
      { id: 'f2', requirement_ids: ['r2'] },
    ];
    const latest = latestAttemptByFlashcard([
      { flashcardId: 'f1', confidence: 'low', practicedAt: '2026-01-01T00:00:00.000Z' },
      { flashcardId: 'f2', confidence: 'low', practicedAt: '2026-01-02T00:00:00.000Z' },
    ]);

    const analytics = buildRequirementAnalytics(flashcards, latest, requirementItems);

    expect(analytics[1]).toEqual({
      requirementId: 'r2',
      flashcardCount: 2,
      practicedFlashcardCount: 2,
      lowCount: 2,
      mediumCount: 0,
      highCount: 0,
      strengthPercent: 0,
      weaknessPercent: 100,
    });
  });

  test('8. mixed confidence requirement analytics', () => {
    const flashcards = [
      { id: 'f1', requirement_ids: ['r4'] },
      { id: 'f2', requirement_ids: ['r4'] },
      { id: 'f3', requirement_ids: ['r4'] },
    ];
    const latest = latestAttemptByFlashcard([
      { flashcardId: 'f1', confidence: 'low', practicedAt: '2026-01-01T00:00:00.000Z' },
      { flashcardId: 'f2', confidence: 'medium', practicedAt: '2026-01-02T00:00:00.000Z' },
      { flashcardId: 'f3', confidence: 'high', practicedAt: '2026-01-03T00:00:00.000Z' },
    ]);

    const analytics = buildRequirementAnalytics(flashcards, latest, requirementItems);

    expect(analytics[2]).toEqual({
      requirementId: 'r4',
      flashcardCount: 3,
      practicedFlashcardCount: 3,
      lowCount: 1,
      mediumCount: 1,
      highCount: 1,
      strengthPercent: 50,
      weaknessPercent: 50,
    });
  });
});

describe('buildPracticeSummary', () => {
  test('computes coverage and weak requirements from latest confidence', () => {
    const kit = baseKit({
      practice: {
        attempts: [
          { flashcardId: 'f1', confidence: 'low', practicedAt: '2026-01-01T00:00:00.000Z' },
          { flashcardId: 'f1', confidence: 'high', practicedAt: '2026-01-05T00:00:00.000Z' },
          { flashcardId: 'f2', confidence: 'low', practicedAt: '2026-01-02T00:00:00.000Z' },
          { flashcardId: 'f3', confidence: 'medium', practicedAt: '2026-01-03T00:00:00.000Z' },
        ],
      },
    });

    const summary = buildPracticeSummary(kit);

    expect(summary.totalFlashcards).toBe(3);
    expect(summary.practicedFlashcards).toBe(3);
    expect(summary.coveragePercent).toBe(100);
    expect(summary.lowConfidenceCount).toBe(1);
    expect(summary.mediumConfidenceCount).toBe(1);
    expect(summary.highConfidenceCount).toBe(1);
    expect(summary.weakRequirementIds).toEqual(['r2']);
    expect(summary.requirements).toHaveLength(3);
    expect(summary.requirements[0]).toMatchObject({
      requirementId: 'r1',
      flashcardCount: 1,
      practicedFlashcardCount: 1,
      highCount: 1,
      strengthPercent: 100,
    });
    expect(summary.requirements[1]).toMatchObject({
      requirementId: 'r2',
      lowCount: 1,
      strengthPercent: 0,
      weaknessPercent: 100,
    });
  });

  test('returns zero coverage when nothing practiced yet', () => {
    const summary = buildPracticeSummary(baseKit());

    expect(summary.totalFlashcards).toBe(3);
    expect(summary.practicedFlashcards).toBe(0);
    expect(summary.coveragePercent).toBe(0);
    expect(summary.lowConfidenceCount).toBe(0);
    expect(summary.mediumConfidenceCount).toBe(0);
    expect(summary.highConfidenceCount).toBe(0);
    expect(summary.weakRequirementIds).toEqual([]);
    expect(summary.requirements).toEqual([
      {
        requirementId: 'r1',
        flashcardCount: 1,
        practicedFlashcardCount: 0,
        lowCount: 0,
        mediumCount: 0,
        highCount: 0,
        strengthPercent: 0,
        weaknessPercent: 0,
      },
      {
        requirementId: 'r2',
        flashcardCount: 1,
        practicedFlashcardCount: 0,
        lowCount: 0,
        mediumCount: 0,
        highCount: 0,
        strengthPercent: 0,
        weaknessPercent: 0,
      },
      {
        requirementId: 'r4',
        flashcardCount: 1,
        practicedFlashcardCount: 0,
        lowCount: 0,
        mediumCount: 0,
        highCount: 0,
        strengthPercent: 0,
        weaknessPercent: 0,
      },
    ]);
  });
});

describe('recordPracticeAttempt', () => {
  test('persists a new attempt and returns updated summary', async () => {
    const kit = baseKit();
    mockFindById(kit);

    const updatedKit = baseKit({
      practice: {
        attempts: [{ flashcardId: 'f1', confidence: 'low', practicedAt: new Date('2026-01-01') }],
      },
    });
    mockUpdate(updatedKit);

    const result = await recordPracticeAttempt('kit123', 'f1', { confidence: 'low' });

    expect(Kit.findByIdAndUpdate).toHaveBeenCalledWith(
      'kit123',
      {
        $push: {
          'practice.attempts': {
            flashcardId: 'f1',
            confidence: 'low',
            practicedAt: expect.any(Date),
          },
        },
      },
      { new: true }
    );
    expect(result.idempotent).toBe(false);
    expect(result.attempt.flashcardId).toBe('f1');
    expect(result.attempt.confidence).toBe('low');
    expect(result.summary.practicedFlashcards).toBe(1);
    expect(result.summary.requirements).toHaveLength(3);
  });

  test('does not duplicate identical retry within idempotency window', async () => {
    const now = Date.now();
    const recentAttempt = {
      flashcardId: 'f1',
      confidence: 'medium',
      practicedAt: new Date(now - 2_000),
    };
    const kit = baseKit({
      practice: { attempts: [recentAttempt] },
    });
    mockFindById(kit);

    const result = await recordPracticeAttempt('kit123', 'f1', { confidence: 'medium' });

    expect(Kit.findByIdAndUpdate).not.toHaveBeenCalled();
    expect(result.idempotent).toBe(true);
    expect(result.attempt).toEqual(recentAttempt);
  });

  test('allows new attempt after idempotency window', async () => {
    const oldAttempt = {
      flashcardId: 'f1',
      confidence: 'low',
      practicedAt: new Date(Date.now() - IDEMPOTENCY_WINDOW_MS - 1),
    };
    const kit = baseKit({
      practice: { attempts: [oldAttempt] },
    });
    mockFindById(kit);
    mockUpdate(
      baseKit({
        practice: {
          attempts: [oldAttempt, { flashcardId: 'f1', confidence: 'low', practicedAt: new Date() }],
        },
      })
    );

    const result = await recordPracticeAttempt('kit123', 'f1', { confidence: 'low' });

    expect(Kit.findByIdAndUpdate).toHaveBeenCalled();
    expect(result.idempotent).toBe(false);
  });

  test('allows confidence change within idempotency window', async () => {
    const recentAttempt = {
      flashcardId: 'f1',
      confidence: 'low',
      practicedAt: new Date(Date.now() - 1_000),
    };
    const kit = baseKit({
      practice: { attempts: [recentAttempt] },
    });
    mockFindById(kit);
    mockUpdate(
      baseKit({
        practice: {
          attempts: [
            recentAttempt,
            { flashcardId: 'f1', confidence: 'high', practicedAt: new Date() },
          ],
        },
      })
    );

    const result = await recordPracticeAttempt('kit123', 'f1', { confidence: 'high' });

    expect(Kit.findByIdAndUpdate).toHaveBeenCalled();
    expect(result.idempotent).toBe(false);
    expect(result.attempt.confidence).toBe('high');
  });

  test('rejects invalid confidence', async () => {
    mockFindById(baseKit());

    await expect(recordPracticeAttempt('kit123', 'f1', { confidence: 'sure' })).rejects.toMatchObject({
      status: 400,
    });
    expect(Kit.findByIdAndUpdate).not.toHaveBeenCalled();
  });

  test('rejects unknown flashcard', async () => {
    mockFindById(baseKit());

    await expect(recordPracticeAttempt('kit123', 'f99', { confidence: 'low' })).rejects.toMatchObject({
      status: 404,
    });
    expect(Kit.findByIdAndUpdate).not.toHaveBeenCalled();
  });

  test('rejects when kit is not ready', async () => {
    mockFindById(baseKit({ status: 'generating' }));

    await expect(recordPracticeAttempt('kit123', 'f1', { confidence: 'low' })).rejects.toMatchObject({
      status: 409,
    });
  });
});

describe('getPracticeSummary', () => {
  test('returns summary for ready kit', async () => {
    const kit = baseKit({
      practice: {
        attempts: [{ flashcardId: 'f1', confidence: 'high', practicedAt: new Date() }],
      },
    });
    mockFindById(kit);

    const summary = await getPracticeSummary('kit123');

    expect(summary.totalFlashcards).toBe(3);
    expect(summary.practicedFlashcards).toBe(1);
    expect(summary.highConfidenceCount).toBe(1);
    expect(summary.requirements).toHaveLength(3);
  });

  test('returns 404 when kit missing', async () => {
    mockFindById(null);

    await expect(getPracticeSummary('missing')).rejects.toMatchObject({ status: 404 });
  });
});
