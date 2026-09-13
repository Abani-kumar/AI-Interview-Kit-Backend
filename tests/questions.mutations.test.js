jest.mock('../src/models/Kit');

const Kit = require('../src/models/Kit');
const {
  updateQuestion,
  addQuestion,
  deleteQuestion,
  reorderQuestions,
  nextQuestionId,
  detachQuestionFromSchedule,
  VALID_CATEGORIES,
} = require('../src/kits/questions.mutations');
const { withGeneratedState } = require('../src/kits/contentState');
const { getPersistPayload } = require('./helpers/persistPayload');

function baseKit(overrides = {}) {
  return {
    _id: 'kit123',
    userId: 'user1',
    results: {
      requirements: {
        roleTitle: 'Backend Engineer',
        seniority: 'mid',
        responsibilities: ['Build APIs'],
        items: [
          { id: 'r1', text: 'Node.js experience', kind: 'technical', priority: 'must' },
          { id: 'r2', text: 'Clear communication', kind: 'behavioural', priority: 'nice' },
        ],
      },
      questions: [
        withGeneratedState({
          id: 'q1',
          prompt: 'How do you structure a Node service?',
          question: 'How do you structure a Node service?',
          answer_outline: 'Talk about layers and boundaries.',
          category: 'technical',
          difficulty: 2,
          minutes: 15,
          requirement_ids: ['r1'],
        }),
        withGeneratedState({
          id: 'q2',
          prompt: 'Tell me about a conflict you resolved.',
          question: 'Tell me about a conflict you resolved.',
          answer_outline: 'Use STAR.',
          category: 'behavioural',
          difficulty: 1,
          minutes: 10,
          requirement_ids: ['r2'],
        }),
      ],
      schedule: {
        days_available: 2,
        days: [
          { day: 1, focus: 'technical', question_ids: ['q1'], minutes: 15 },
          { day: 2, focus: 'behavioural', question_ids: ['q2', 'q1'], minutes: 25 },
        ],
      },
      coverage: { uncovered_requirement_ids: [], passes: 1 },
      ...overrides.results,
    },
    data: null,
    ...overrides,
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

describe('nextQuestionId', () => {
  test('allocates next sequential id', () => {
    expect(nextQuestionId([{ id: 'q1' }, { id: 'q2' }])).toBe('q3');
    expect(nextQuestionId([])).toBe('q1');
    expect(nextQuestionId([{ id: 'q5' }, { id: 'custom' }])).toBe('q6');
  });
});

describe('detachQuestionFromSchedule', () => {
  test('removes question id from every day', () => {
    const schedule = {
      days_available: 2,
      days: [
        { day: 1, question_ids: ['q1', 'q2'] },
        { day: 2, question_ids: ['q1'] },
      ],
    };
    const next = detachQuestionFromSchedule(schedule, 'q1');
    expect(next.days[0].question_ids).toEqual(['q2']);
    expect(next.days[1].question_ids).toEqual([]);
    expect(next.days_available).toBe(2);
  });
});

describe('updateQuestion', () => {
  test('editing a generated question sets edited = true', async () => {
    const kit = baseKit();
    mockFindById(kit);
    mockUpdate({
      results: {
        questions: [
          {
            ...kit.results.questions[0],
            prompt: 'Updated prompt',
            question: 'Updated prompt',
            edited: true,
            origin: 'generated',
            pinned: false,
          },
          kit.results.questions[1],
        ],
        coverage: { uncovered_requirement_ids: [], passes: 1 },
        schedule: kit.results.schedule,
      },
    });

    await updateQuestion('kit123', 'q1', { prompt: 'Updated prompt' });

    const payload = getPersistPayload(Kit);
    const updated = payload['results.questions'][0];
    expect(updated.prompt).toBe('Updated prompt');
    expect(updated.origin).toBe('generated');
    expect(updated.edited).toBe(true);
    expect(updated.pinned).toBe(false);
  });

  test('rejects invalid category and difficulty', async () => {
    mockFindById(baseKit());

    await expect(updateQuestion('kit123', 'q1', { category: 'trivia' })).rejects.toMatchObject({
      status: 400,
    });
    await expect(updateQuestion('kit123', 'q1', { difficulty: 4 })).rejects.toMatchObject({
      status: 400,
    });
    await expect(updateQuestion('kit123', 'q1', { difficulty: 1.5 })).rejects.toMatchObject({
      status: 400,
    });
    expect(Kit.findByIdAndUpdate).not.toHaveBeenCalled();
  });

  test('rejects invalid requirement id', async () => {
    mockFindById(baseKit());
    await expect(
      updateQuestion('kit123', 'q1', { requirement_ids: ['r99'] })
    ).rejects.toMatchObject({ status: 400 });
    expect(Kit.findByIdAndUpdate).not.toHaveBeenCalled();
  });

  test('allows empty requirement_ids on update', async () => {
    const kit = baseKit();
    mockFindById(kit);
    mockUpdate({
      results: {
        questions: [{ ...kit.results.questions[0], requirement_ids: [], edited: true }],
        coverage: { uncovered_requirement_ids: ['r1'], passes: 1 },
        schedule: kit.results.schedule,
      },
    });

    await updateQuestion('kit123', 'q1', { requirement_ids: [] });
    const payload = getPersistPayload(Kit);
    expect(payload['results.questions'][0].requirement_ids).toEqual([]);
    expect(payload['results.questions'][0].edited).toBe(true);
  });
});

describe('addQuestion', () => {
  test('adds custom question with origin = user', async () => {
    const kit = baseKit();
    mockFindById(kit);
    mockUpdate({
      results: {
        questions: [
          ...kit.results.questions,
          {
            id: 'q3',
            prompt: 'Explain CAP theorem',
            question: 'Explain CAP theorem',
            answer_outline: 'Consistency, Availability, Partition tolerance',
            category: 'system-design',
            difficulty: 3,
            minutes: 20,
            requirement_ids: [],
            origin: 'user',
            edited: false,
            pinned: false,
          },
        ],
        coverage: { uncovered_requirement_ids: [], passes: 1 },
        schedule: kit.results.schedule,
      },
    });

    const result = await addQuestion('kit123', {
      prompt: 'Explain CAP theorem',
      answer_outline: 'Consistency, Availability, Partition tolerance',
      category: 'system-design',
      difficulty: 3,
      minutes: 20,
      requirement_ids: [],
    });

    const payload = getPersistPayload(Kit);
    const added = payload['results.questions'][2];
    expect(added.id).toBe('q3');
    expect(added.origin).toBe('user');
    expect(added.edited).toBe(false);
    expect(added.pinned).toBe(false);
    expect(added.requirement_ids).toEqual([]);
    expect(added.category).toBe('system-design');
    // New question must not mutate schedule
    expect(payload['results.schedule']).toBeUndefined();
    expect(result.question.origin).toBe('user');
  });

  test('custom question with empty requirement_ids is allowed', async () => {
    const kit = baseKit();
    mockFindById(kit);
    mockUpdate({
      results: {
        questions: [
          ...kit.results.questions,
          {
            id: 'q3',
            prompt: 'Walk through a DSA problem',
            question: 'Walk through a DSA problem',
            answer_outline: '',
            category: 'technical',
            difficulty: 2,
            minutes: 15,
            requirement_ids: [],
            origin: 'user',
            edited: false,
            pinned: false,
          },
        ],
        coverage: kit.results.coverage,
      },
    });

    await addQuestion('kit123', {
      prompt: 'Walk through a DSA problem',
      category: 'technical',
      difficulty: 2,
      requirement_ids: [],
    });

    const added = getPersistPayload(Kit)['results.questions'][2];
    expect(added.requirement_ids).toEqual([]);
  });

  test('rejects unknown requirement id on add', async () => {
    mockFindById(baseKit());
    await expect(
      addQuestion('kit123', {
        prompt: 'Something',
        category: 'technical',
        difficulty: 1,
        requirement_ids: ['r_missing'],
      })
    ).rejects.toMatchObject({ status: 400 });
  });
});

describe('deleteQuestion', () => {
  test('deletes question and removes it from schedule atomically', async () => {
    const kit = baseKit();
    mockFindById(kit);
    mockUpdate({
      results: {
        questions: [kit.results.questions[1]],
        schedule: {
          days_available: 2,
          days: [
            { day: 1, focus: 'technical', question_ids: [], minutes: 15 },
            { day: 2, focus: 'behavioural', question_ids: ['q2'], minutes: 25 },
          ],
        },
        coverage: { uncovered_requirement_ids: ['r1'], passes: 1 },
      },
    });

    await deleteQuestion('kit123', 'q1');

    expect(Kit.findByIdAndUpdate).toHaveBeenCalledTimes(1);
    const payload = getPersistPayload(Kit);
    expect(payload['results.questions'].map((q) => q.id)).toEqual(['q2']);
    expect(payload['results.schedule'].days[0].question_ids).toEqual([]);
    expect(payload['results.schedule'].days[1].question_ids).toEqual(['q2']);
    expect(payload['results.schedule'].days_available).toBe(2);
  });
});

describe('reorderQuestions', () => {
  test('reorders while preserving ids and content', async () => {
    const kit = baseKit();
    mockFindById(kit);
    mockUpdate({
      results: {
        questions: [kit.results.questions[1], kit.results.questions[0]],
        coverage: kit.results.coverage,
        schedule: kit.results.schedule,
      },
    });

    await reorderQuestions('kit123', ['q2', 'q1']);

    const items = getPersistPayload(Kit)['results.questions'];
    expect(items.map((q) => q.id)).toEqual(['q2', 'q1']);
    expect(items[0].prompt).toBe(kit.results.questions[1].prompt);
    expect(items[1].prompt).toBe(kit.results.questions[0].prompt);
    expect(items[0].requirement_ids).toEqual(['r2']);
    // Schedule must not change on reorder
    expect(getPersistPayload(Kit)['results.schedule']).toBeUndefined();
  });

  test('rejects invalid orderings', async () => {
    mockFindById(baseKit());
    await expect(reorderQuestions('kit123', ['q1'])).rejects.toMatchObject({ status: 400 });
    await expect(reorderQuestions('kit123', ['q1', 'q1'])).rejects.toMatchObject({ status: 400 });
    await expect(reorderQuestions('kit123', ['q1', 'q99'])).rejects.toMatchObject({
      status: 400,
    });
  });
});

describe('ownership protection', () => {
  test('ownsKit rejects non-owners with 404', async () => {
    jest.resetModules();
    jest.doMock('../src/models/Kit', () => ({
      findById: jest.fn().mockResolvedValue({
        userId: { toString: () => 'owner-id' },
      }),
    }));

    const ownsKit = require('../src/middleware/ownsKit');
    const req = {
      params: { id: 'kit123' },
      user: { _id: { toString: () => 'other-user' } },
    };
    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };
    const next = jest.fn();

    await ownsKit(req, res, next);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ error: 'Kit not found' });
    expect(next).not.toHaveBeenCalled();
  });

  test('question mutation routes are wired with protect + ownsKit', () => {
    const fs = require('fs');
    const path = require('path');
    const source = fs.readFileSync(path.join(__dirname, '../src/kits/kit.routes.js'), 'utf8');

    expect(source).toMatch(/protect,\s*ownsKit,\s*postQuestion/);
    expect(source).toMatch(/protect,\s*ownsKit,\s*putQuestionsOrder/);
    expect(source).toMatch(/protect,\s*ownsKit,\s*patchQuestion/);
    expect(source).toMatch(/protect,\s*ownsKit,\s*removeQuestion/);
  });
});

describe('VALID_CATEGORIES', () => {
  test('matches builder contract', () => {
    expect(VALID_CATEGORIES).toEqual([
      'technical',
      'behavioural',
      'system-design',
      'company-fit',
    ]);
  });
});
