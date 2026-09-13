jest.mock('../src/models/Kit');

const Kit = require('../src/models/Kit');
const { getPersistPayload } = require('./helpers/persistPayload');
const {
  moveQuestion,
  reorderDayQuestions,
  updateDayFocus,
  recalculateDayMinutes,
  MINUTES_PER_QUESTION,
} = require('../src/kits/schedule.mutations');

function baseKit(overrides = {}) {
  return {
    _id: 'kit123',
    userId: 'user1',
    input: { jd: 'JD', companyUrl: 'https://acme.com', days: 2 },
    results: {
      requirements: {
        items: [
          { id: 'r1', text: 'Node.js', kind: 'technical', priority: 'must' },
          { id: 'r2', text: 'Comms', kind: 'behavioural', priority: 'nice' },
        ],
      },
      questions: [
        {
          id: 'q1',
          prompt: 'Structure a Node service?',
          category: 'technical',
          difficulty: 2,
          minutes: 15,
          requirement_ids: ['r1'],
        },
        {
          id: 'q2',
          prompt: 'Resolve a conflict?',
          category: 'behavioural',
          difficulty: 1,
          minutes: 15,
          requirement_ids: ['r2'],
        },
        {
          id: 'q3',
          prompt: 'Design a rate limiter?',
          category: 'system-design',
          difficulty: 3,
          minutes: 15,
          requirement_ids: ['r1'],
        },
        {
          id: 'q4',
          prompt: 'Why this company?',
          category: 'company-fit',
          difficulty: 1,
          minutes: 15,
          requirement_ids: [],
        },
      ],
      schedule: {
        days_available: 2,
        days: [
          {
            day: 1,
            focus: 'technical',
            question_ids: ['q1', 'q2'],
            minutes: 2 * MINUTES_PER_QUESTION,
          },
          {
            day: 2,
            focus: 'system-design',
            question_ids: ['q3', 'q4'],
            minutes: 2 * MINUTES_PER_QUESTION,
          },
        ],
      },
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
  Kit.findByIdAndUpdate.mockImplementation((_id, update) => ({
    lean: () =>
      Promise.resolve(
        updatedKit || {
          results: {
            schedule: update['results.schedule'],
          },
        }
      ),
  }));
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('recalculateDayMinutes', () => {
  test('uses fixed V1 minutes per question', () => {
    const day = { day: 1, question_ids: ['q1', 'q2', 'q3'], minutes: 0 };
    recalculateDayMinutes(day);
    expect(day.minutes).toBe(3 * MINUTES_PER_QUESTION);
  });
});

describe('moveQuestion', () => {
  test('moves question Day 1 → Day 2 and recalculates minutes', async () => {
    const kit = baseKit();
    mockFindById(kit);
    mockUpdate();

    await moveQuestion('kit123', { questionId: 'q2', toDay: 2 });

    const schedule = getPersistPayload(Kit)['results.schedule'];
    expect(schedule.days).toHaveLength(2);
    expect(schedule.days_available).toBe(2);
    expect(schedule.days[0].question_ids).toEqual(['q1']);
    expect(schedule.days[1].question_ids).toEqual(['q3', 'q4', 'q2']);
    expect(schedule.days[0].minutes).toBe(1 * MINUTES_PER_QUESTION);
    expect(schedule.days[1].minutes).toBe(3 * MINUTES_PER_QUESTION);
  });

  test('moves question back Day 2 → Day 1', async () => {
    const kit = baseKit();
    kit.results.schedule = {
      days_available: 2,
      days: [
        { day: 1, focus: 'technical', question_ids: ['q1'], minutes: MINUTES_PER_QUESTION },
        {
          day: 2,
          focus: 'mixed',
          question_ids: ['q3', 'q4', 'q2'],
          minutes: 3 * MINUTES_PER_QUESTION,
        },
      ],
    };
    mockFindById(kit);
    mockUpdate();

    await moveQuestion('kit123', { questionId: 'q2', toDay: 1 });

    const schedule = getPersistPayload(Kit)['results.schedule'];
    expect(schedule.days[0].question_ids).toEqual(['q1', 'q2']);
    expect(schedule.days[1].question_ids).toEqual(['q3', 'q4']);
    expect(schedule.days[0].minutes).toBe(2 * MINUTES_PER_QUESTION);
    expect(schedule.days[1].minutes).toBe(2 * MINUTES_PER_QUESTION);
    expect(schedule.days).toHaveLength(2);
  });

  test('rejects invalid day', async () => {
    mockFindById(baseKit());
    await expect(moveQuestion('kit123', { questionId: 'q1', toDay: 99 })).rejects.toMatchObject({
      status: 400,
    });
    expect(Kit.findByIdAndUpdate).not.toHaveBeenCalled();
  });

  test('rejects invalid / unknown question', async () => {
    mockFindById(baseKit());
    await expect(moveQuestion('kit123', { questionId: 'q99', toDay: 2 })).rejects.toMatchObject({
      status: 400,
    });
    expect(Kit.findByIdAndUpdate).not.toHaveBeenCalled();
  });

  test('preserves exactly original number of days', async () => {
    mockFindById(baseKit());
    mockUpdate();
    await moveQuestion('kit123', { questionId: 'q1', toDay: 2 });
    const schedule = getPersistPayload(Kit)['results.schedule'];
    expect(schedule.days).toHaveLength(2);
    expect(schedule.days_available).toBe(2);
  });
});

describe('reorderDayQuestions', () => {
  test('reorders questions within a day', async () => {
    mockFindById(baseKit());
    mockUpdate();

    await reorderDayQuestions('kit123', 1, ['q2', 'q1']);

    const schedule = getPersistPayload(Kit)['results.schedule'];
    expect(schedule.days[0].question_ids).toEqual(['q2', 'q1']);
    expect(schedule.days[1].question_ids).toEqual(['q3', 'q4']);
    expect(schedule.days[0].minutes).toBe(2 * MINUTES_PER_QUESTION);
    expect(schedule.days).toHaveLength(2);
  });

  test('rejects reorder that would introduce foreign/duplicate ids', async () => {
    mockFindById(baseKit());
    await expect(reorderDayQuestions('kit123', 1, ['q1'])).rejects.toMatchObject({ status: 400 });
    await expect(reorderDayQuestions('kit123', 1, ['q1', 'q1'])).rejects.toMatchObject({
      status: 400,
    });
    await expect(reorderDayQuestions('kit123', 1, ['q1', 'q3'])).rejects.toMatchObject({
      status: 400,
    });
  });
});

describe('updateDayFocus', () => {
  test('updates day focus without changing question order or day count', async () => {
    mockFindById(baseKit());
    mockUpdate();

    await updateDayFocus('kit123', 1, { focus: 'algorithms' });

    const schedule = getPersistPayload(Kit)['results.schedule'];
    expect(schedule.days[0].focus).toBe('algorithms');
    expect(schedule.days[0].question_ids).toEqual(['q1', 'q2']);
    expect(schedule.days).toHaveLength(2);
  });

  test('rejects empty focus', async () => {
    mockFindById(baseKit());
    await expect(updateDayFocus('kit123', 1, { focus: '  ' })).rejects.toMatchObject({
      status: 400,
    });
  });
});

describe('duplicate prevention', () => {
  test('move within same day with index still keeps a single occurrence', async () => {
    mockFindById(baseKit());
    mockUpdate();

    await moveQuestion('kit123', { questionId: 'q1', toDay: 1, index: 1 });

    const schedule = getPersistPayload(Kit)['results.schedule'];
    const allIds = schedule.days.flatMap((d) => d.question_ids);
    expect(allIds.filter((id) => id === 'q1')).toHaveLength(1);
    expect(schedule.days[0].question_ids).toEqual(['q2', 'q1']);
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

  test('schedule mutation routes are wired with protect + ownsKit', () => {
    const fs = require('fs');
    const path = require('path');
    const source = fs.readFileSync(path.join(__dirname, '../src/kits/kit.routes.js'), 'utf8');

    expect(source).toMatch(/protect,\s*ownsKit,\s*postMoveQuestion/);
    expect(source).toMatch(/protect,\s*ownsKit,\s*putDayQuestionsOrder/);
    expect(source).toMatch(/protect,\s*ownsKit,\s*patchDayFocus/);
  });
});
