jest.mock('../src/models/Kit');
jest.mock('../src/queue/queue', () => ({
  enqueueStage: jest.fn().mockResolvedValue({ id: 'job1' }),
}));

const Kit = require('../src/models/Kit');
const { enqueueStage } = require('../src/queue/queue');
const { requestRegeneration } = require('../src/kits/regenerate.mutations');
const {
  assertRegenerationBaseline,
  reloadKitForConcurrencyCheck,
} = require('../src/kits/regenerationContext');
const {
  withGeneratedState,
  withUserState,
  markEdited,
} = require('../src/kits/contentState');

function readyKit(overrides = {}) {
  return {
    _id: 'kit123',
    status: 'ready',
    contentRevision: 2,
    results: {
      companyBrief: withGeneratedState({
        summary: 'Summary',
        what_they_do: 'Builds software',
        sources: [],
      }),
      requirements: {
        items: [
          { id: 'r1', text: 'Node.js', kind: 'technical', priority: 'must' },
          { id: 'r2', text: 'Communication', kind: 'behavioural', priority: 'nice' },
        ],
      },
      questions: [
        withGeneratedState({
          id: 'q1',
          question: 'Generated',
          category: 'technical',
          difficulty: 1,
          minutes: 10,
          requirement_ids: ['r1'],
        }),
        markEdited(
          withGeneratedState({
            id: 'q2',
            question: 'Edited',
            category: 'technical',
            difficulty: 2,
            minutes: 10,
            requirement_ids: ['r1'],
          })
        ),
        withUserState({
          id: 'q3',
          question: 'User',
          category: 'behavioural',
          difficulty: 1,
          minutes: 10,
          requirement_ids: [],
        }),
      ],
      flashcards: [
        withGeneratedState({ id: 'f1', front: 'Front', back: 'Back', requirement_ids: [] }),
      ],
      schedule: { days_available: 2, days: [{ day: 1, question_ids: ['q1'], minutes: 10 }] },
      coverage: { uncovered_requirement_ids: [], passes: 1 },
      coveragePass: 0,
    },
    data: { questions: [] },
    stages: {
      'generate-brief': { status: 'done' },
      'generate-questions': { status: 'done' },
      'check-coverage': { status: 'done' },
      'generate-flashcards': { status: 'done' },
      'build-schedule': { status: 'done' },
      'validate-and-finalize': { status: 'done' },
    },
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('requestRegeneration', () => {
  test('enqueues question regeneration and resets downstream stages', async () => {
    const kit = readyKit();
    Kit.findById.mockImplementation(() => ({ lean: () => Promise.resolve(kit) }));
    Kit.findOneAndUpdate.mockImplementation(() => ({ lean: () => Promise.resolve({ ...kit, status: 'generating' }) }));

    const result = await requestRegeneration('kit123', 'questions', { contentRevision: 2 });

    expect(result.status).toBe('generating');
    expect(result.section).toBe('questions');
    expect(result.progressUrl).toBe('/api/kits/kit123/progress');
    expect(enqueueStage).toHaveBeenCalledWith(
      'kit123',
      'generate-questions',
      expect.any(Object),
      expect.any(Number)
    );

    const updateArg = Kit.findOneAndUpdate.mock.calls[0][1];
    expect(updateArg.$set.status).toBe('generating');
    expect(updateArg.$set.currentStage).toBe('generate-questions');
    expect(updateArg.$set.data).toBeNull();
    expect(updateArg.$set['results.coveragePass']).toBe(0);
    expect(updateArg.$set['stages.generate-questions.status']).toBe('pending');
    expect(updateArg.$set['stages.validate-and-finalize.status']).toBe('pending');
    expect(updateArg.$set['stages.extract-requirements.status']).toBeUndefined();
  });

  test('brief regeneration only resets brief + finalize stages', async () => {
    const kit = readyKit();
    Kit.findById.mockImplementation(() => ({ lean: () => Promise.resolve(kit) }));
    Kit.findOneAndUpdate.mockImplementation(() => ({ lean: () => Promise.resolve(kit) }));

    await requestRegeneration('kit123', 'brief');

    expect(enqueueStage).toHaveBeenCalledWith(
      'kit123',
      'generate-brief',
      expect.any(Object),
      expect.any(Number)
    );

    const updateArg = Kit.findOneAndUpdate.mock.calls[0][1];
    expect(updateArg.$set['stages.generate-brief.status']).toBe('pending');
    expect(updateArg.$set['stages.validate-and-finalize.status']).toBe('pending');
    expect(updateArg.$set['stages.generate-questions.status']).toBeUndefined();
  });

  test('rejects stale contentRevision with structured conflict', async () => {
    const kit = readyKit({ contentRevision: 5 });
    Kit.findById.mockImplementation(() => ({ lean: () => Promise.resolve(kit) }));

    await expect(
      requestRegeneration('kit123', 'questions', { contentRevision: 2 })
    ).rejects.toMatchObject({
      status: 409,
      code: 'REGENERATION_CONFLICT',
      details: {
        code: 'REGENERATION_CONFLICT',
        baselineContentRevision: 2,
        currentContentRevision: 5,
      },
    });

    expect(enqueueStage).not.toHaveBeenCalled();
  });

  test('validates missingRequirementIds against known requirements', async () => {
    const kit = readyKit();
    Kit.findById.mockImplementation(() => ({ lean: () => Promise.resolve(kit) }));

    await expect(
      requestRegeneration('kit123', 'questions', { missingRequirementIds: ['r99'] })
    ).rejects.toMatchObject({ status: 400 });

    expect(enqueueStage).not.toHaveBeenCalled();
  });

  test('stores missingRequirementIds in regeneration metadata', async () => {
    const kit = readyKit();
    Kit.findById.mockImplementation(() => ({ lean: () => Promise.resolve(kit) }));
    Kit.findOneAndUpdate.mockImplementation(() => ({ lean: () => Promise.resolve(kit) }));

    await requestRegeneration('kit123', 'questions', { missingRequirementIds: ['r2'] });

    const updateArg = Kit.findOneAndUpdate.mock.calls[0][1];
    expect(updateArg.$set['results.regeneration'].missingRequirementIds).toEqual(['r2']);
  });

  test('rejects regeneration while kit is generating', async () => {
    const kit = readyKit({ status: 'generating' });
    Kit.findById.mockImplementation(() => ({ lean: () => Promise.resolve(kit) }));

    await expect(requestRegeneration('kit123', 'flashcards')).rejects.toMatchObject({
      status: 409,
      message: 'Kit is already generating',
    });
  });
});

describe('regeneration concurrency guards', () => {
  test('assertRegenerationBaseline throws when contentRevision changed', () => {
    const kit = {
      contentRevision: 4,
      results: {
        regeneration: { baselineContentRevision: 2, section: 'questions' },
      },
    };

    expect(() => assertRegenerationBaseline(kit)).toThrow(/Regeneration conflict/);
    try {
      assertRegenerationBaseline(kit);
    } catch (err) {
      expect(err.code).toBe('REGENERATION_CONFLICT');
      expect(err.details.currentContentRevision).toBe(4);
      expect(err.details.baselineContentRevision).toBe(2);
    }
  });

  test('reloadKitForConcurrencyCheck rejects stale regeneration before persist', async () => {
    Kit.findById.mockImplementation(() => ({
      lean: () =>
        Promise.resolve({
          _id: 'kit123',
          contentRevision: 6,
          results: { regeneration: { baselineContentRevision: 2, section: 'questions' } },
        }),
    }));

    await expect(reloadKitForConcurrencyCheck('kit123')).rejects.toMatchObject({
      code: 'REGENERATION_CONFLICT',
    });
  });
});
