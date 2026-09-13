const {
  buildScheduleAllocation,
  validateSchedule,
  splitQuestions,
  sortByDifficultyDesc,
  distributeRoundRobin,
  deriveFocus,
  MINUTES_PER_QUESTION,
} = require('../src/kits/stages/buildSchedule/scheduleAllocator');

// ─── helpers ─────────────────────────────────────────────────────────────────

function makeRequirements(defs) {
  return defs.map(([id, priority]) => ({ id, priority }));
}

function makeQuestion(id, reqIds, difficulty = 2, category = 'technical') {
  return { id, requirement_ids: reqIds, difficulty, category };
}

// ─── splitQuestions ───────────────────────────────────────────────────────────

describe('splitQuestions', () => {
  const requirements = makeRequirements([['r1', 'must'], ['r2', 'nice']]);

  test('splits into must and nice based on requirement priority', () => {
    const questions = [
      makeQuestion('q1', ['r1']),
      makeQuestion('q2', ['r2']),
    ];
    const { must, nice } = splitQuestions(questions, requirements);
    expect(must.map((q) => q.id)).toEqual(['q1']);
    expect(nice.map((q) => q.id)).toEqual(['q2']);
  });

  test('a question covering both must and nice req is treated as must', () => {
    const questions = [makeQuestion('q1', ['r1', 'r2'])];
    const { must } = splitQuestions(questions, requirements);
    expect(must.map((q) => q.id)).toContain('q1');
  });

  test('returns empty buckets for empty question list', () => {
    const { must, nice } = splitQuestions([], requirements);
    expect(must).toEqual([]);
    expect(nice).toEqual([]);
  });

  test('all must when no nice requirements exist', () => {
    const allMustReqs = makeRequirements([['r1', 'must'], ['r2', 'must']]);
    const questions = [makeQuestion('q1', ['r1']), makeQuestion('q2', ['r2'])];
    const { must, nice } = splitQuestions(questions, allMustReqs);
    expect(must).toHaveLength(2);
    expect(nice).toHaveLength(0);
  });
});

// ─── sortByDifficultyDesc ─────────────────────────────────────────────────────

describe('sortByDifficultyDesc', () => {
  test('sorts by difficulty descending', () => {
    const questions = [makeQuestion('q1', [], 1), makeQuestion('q2', [], 3), makeQuestion('q3', [], 2)];
    const sorted = sortByDifficultyDesc(questions);
    expect(sorted.map((q) => q.id)).toEqual(['q2', 'q3', 'q1']);
  });

  test('does not mutate the original array', () => {
    const questions = [makeQuestion('q1', [], 3), makeQuestion('q2', [], 1)];
    const original = [...questions];
    sortByDifficultyDesc(questions);
    expect(questions[0].id).toBe(original[0].id);
  });

  test('handles missing difficulty with default of 1', () => {
    const questions = [{ id: 'q1', requirement_ids: [] }, makeQuestion('q2', [], 3)];
    const sorted = sortByDifficultyDesc(questions);
    expect(sorted[0].id).toBe('q2');
  });
});

// ─── distributeRoundRobin ─────────────────────────────────────────────────────

describe('distributeRoundRobin', () => {
  function makeBuckets(n) {
    return Array.from({ length: n }, (_, i) => ({ day: i + 1, question_ids: [], minutes: 0 }));
  }

  test('distributes evenly across days', () => {
    const buckets = makeBuckets(3);
    const questions = ['q1', 'q2', 'q3', 'q4', 'q5', 'q6'].map((id) => makeQuestion(id, []));
    distributeRoundRobin(questions, buckets);
    expect(buckets[0].question_ids).toEqual(['q1', 'q4']);
    expect(buckets[1].question_ids).toEqual(['q2', 'q5']);
    expect(buckets[2].question_ids).toEqual(['q3', 'q6']);
  });

  test('adds correct minutes per question', () => {
    const buckets = makeBuckets(2);
    distributeRoundRobin([makeQuestion('q1', []), makeQuestion('q2', [])], buckets);
    expect(buckets[0].minutes).toBe(MINUTES_PER_QUESTION);
    expect(buckets[1].minutes).toBe(MINUTES_PER_QUESTION);
  });

  test('handles more days than questions — some days stay empty', () => {
    const buckets = makeBuckets(5);
    distributeRoundRobin([makeQuestion('q1', [])], buckets);
    expect(buckets[0].question_ids).toEqual(['q1']);
    expect(buckets[1].question_ids).toEqual([]);
    expect(buckets[4].question_ids).toEqual([]);
  });

  test('handles empty questions array — no changes to buckets', () => {
    const buckets = makeBuckets(3);
    distributeRoundRobin([], buckets);
    expect(buckets.every((b) => b.question_ids.length === 0)).toBe(true);
  });
});

// ─── buildScheduleAllocation ─────────────────────────────────────────────────

describe('buildScheduleAllocation', () => {
  const requirements = makeRequirements([['r1', 'must'], ['r2', 'must'], ['r3', 'nice']]);

  test('returns exactly N days', () => {
    const questions = [makeQuestion('q1', ['r1']), makeQuestion('q2', ['r2'])];
    const schedule = buildScheduleAllocation(questions, requirements, 5);
    expect(schedule.days).toHaveLength(5);
    expect(schedule.days_available).toBe(5);
  });

  test('1-day schedule assigns all questions to day 1', () => {
    const questions = [makeQuestion('q1', ['r1']), makeQuestion('q2', ['r2']), makeQuestion('q3', ['r3'])];
    const schedule = buildScheduleAllocation(questions, requirements, 1);
    expect(schedule.days).toHaveLength(1);
    expect(schedule.days[0].question_ids).toHaveLength(3);
  });

  test('60-day schedule still returns exactly 60 days', () => {
    const questions = Array.from({ length: 10 }, (_, i) => makeQuestion(`q${i + 1}`, ['r1']));
    const schedule = buildScheduleAllocation(questions, requirements, 60);
    expect(schedule.days).toHaveLength(60);
  });

  test('must questions appear before nice on earlier days', () => {
    const questions = [
      makeQuestion('q_nice', ['r3'], 3), // nice but hard
      makeQuestion('q_must', ['r1'], 1), // must but easy
    ];
    const schedule = buildScheduleAllocation(questions, requirements, 2);
    // Phase 1 distributes must first — q_must lands on day 1
    const day1Ids = schedule.days[0].question_ids;
    expect(day1Ids).toContain('q_must');
  });

  test('harder must questions land on earlier days via round-robin', () => {
    const questions = [
      makeQuestion('q1', ['r1'], 3), // hard must
      makeQuestion('q2', ['r2'], 1), // easy must
    ];
    const schedule = buildScheduleAllocation(questions, requirements, 2);
    // After difficulty sort: q1(3) then q2(1)
    // Round-robin on 2 days: q1→day1, q2→day2
    expect(schedule.days[0].question_ids).toContain('q1');
    expect(schedule.days[1].question_ids).toContain('q2');
  });

  test('every question is allocated exactly once', () => {
    const questions = Array.from({ length: 7 }, (_, i) => makeQuestion(`q${i + 1}`, ['r1']));
    const schedule = buildScheduleAllocation(questions, requirements, 3);
    const allAssigned = schedule.days.flatMap((d) => d.question_ids);
    expect(allAssigned).toHaveLength(7);
    expect(new Set(allAssigned).size).toBe(7); // no duplicates
  });

  test('empty questions list returns N empty days', () => {
    const schedule = buildScheduleAllocation([], requirements, 3);
    expect(schedule.days).toHaveLength(3);
    expect(schedule.days.every((d) => d.question_ids.length === 0)).toBe(true);
    expect(schedule.days.every((d) => d.minutes === 0)).toBe(true);
  });

  test('empty day has focus of rest', () => {
    const schedule = buildScheduleAllocation([], requirements, 2);
    expect(schedule.days[0].focus).toBe('rest');
  });

  test('minutes is deterministic: count * MINUTES_PER_QUESTION', () => {
    const questions = [makeQuestion('q1', ['r1']), makeQuestion('q2', ['r1'])];
    const schedule = buildScheduleAllocation(questions, requirements, 1);
    expect(schedule.days[0].minutes).toBe(2 * MINUTES_PER_QUESTION);
  });

  test('throws for invalid days value', () => {
    expect(() => buildScheduleAllocation([], requirements, 0)).toThrow('days must be a positive integer');
    expect(() => buildScheduleAllocation([], requirements, -1)).toThrow('days must be a positive integer');
  });
});

// ─── validateSchedule ─────────────────────────────────────────────────────────

describe('validateSchedule', () => {
  const questions = [makeQuestion('q1', ['r1']), makeQuestion('q2', ['r2'])];

  test('passes a valid schedule', () => {
    const schedule = {
      days_available: 2,
      days: [
        { day: 1, question_ids: ['q1'], minutes: MINUTES_PER_QUESTION, focus: 'technical' },
        { day: 2, question_ids: ['q2'], minutes: MINUTES_PER_QUESTION, focus: 'technical' },
      ],
    };
    expect(() => validateSchedule(schedule, questions, 2)).not.toThrow();
  });

  test('throws when day count does not match requested days', () => {
    const schedule = { days_available: 3, days: [{ day: 1, question_ids: [], minutes: 0, focus: 'rest' }] };
    expect(() => validateSchedule(schedule, questions, 3)).toThrow('Expected 3 day entries, got 1');
  });

  test('throws when question_id does not exist', () => {
    const schedule = {
      days_available: 1,
      days: [{ day: 1, question_ids: ['q_unknown'], minutes: 0, focus: 'technical' }],
    };
    expect(() => validateSchedule(schedule, questions, 1)).toThrow('unknown question_id');
  });

  test('throws when question assigned more than once', () => {
    const schedule = {
      days_available: 2,
      days: [
        { day: 1, question_ids: ['q1'], minutes: MINUTES_PER_QUESTION, focus: 'technical' },
        { day: 2, question_ids: ['q1'], minutes: MINUTES_PER_QUESTION, focus: 'technical' }, // duplicate
      ],
    };
    expect(() => validateSchedule(schedule, questions, 2)).toThrow('Duplicate question assignment');
  });

  test('throws when not all questions are allocated', () => {
    const schedule = {
      days_available: 2,
      days: [
        { day: 1, question_ids: ['q1'], minutes: MINUTES_PER_QUESTION, focus: 'technical' },
        { day: 2, question_ids: [], minutes: 0, focus: 'rest' }, // q2 missing
      ],
    };
    expect(() => validateSchedule(schedule, questions, 2)).toThrow('Questions not allocated');
  });
});

// ─── stage handler (integration-style with mocks) ────────────────────────────

jest.mock('../src/models/Kit');

describe('buildSchedule stage handler', () => {
  const baseKit = {
    stages: { 'build-schedule': { status: 'pending' } },
    input: { days: 3 },
    results: {
      requirements: {
        items: makeRequirements([['r1', 'must'], ['r2', 'nice']]),
      },
      questions: [
        makeQuestion('q1', ['r1'], 3),
        makeQuestion('q2', ['r1'], 2),
        makeQuestion('q3', ['r2'], 1),
      ],
      schedule: null,
    },
  };

  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetModules();
  });

  test('persists a valid schedule with exactly N days', async () => {
    const Kit = require('../src/models/Kit');
    Kit.findById.mockReturnValue({ lean: () => Promise.resolve(baseKit) });
    Kit.findByIdAndUpdate.mockResolvedValue({});

    const buildSchedule = require('../src/kits/stages/buildSchedule');
    await buildSchedule('kit123');

    const updateArg = Kit.findByIdAndUpdate.mock.calls[0][1];
    expect(updateArg['results.schedule'].days).toHaveLength(3);
    expect(updateArg['results.schedule'].days_available).toBe(3);
  });

  test('is idempotent when schedule already exists', async () => {
    const Kit = require('../src/models/Kit');
    const doneKit = {
      ...baseKit,
      stages: { 'build-schedule': { status: 'done' } },
      results: { ...baseKit.results, schedule: { days_available: 3, days: [] } },
    };
    Kit.findById.mockReturnValue({ lean: () => Promise.resolve(doneKit) });

    const buildSchedule = require('../src/kits/stages/buildSchedule');
    await buildSchedule('kit123');
    expect(Kit.findByIdAndUpdate).not.toHaveBeenCalled();
  });

  test('throws for invalid days value', async () => {
    const Kit = require('../src/models/Kit');
    const badKit = { ...baseKit, input: { days: 0 } };
    Kit.findById.mockReturnValue({ lean: () => Promise.resolve(badKit) });

    const buildSchedule = require('../src/kits/stages/buildSchedule');
    await expect(buildSchedule('kit123')).rejects.toThrow('Invalid days value');
  });

  test('all questions are allocated across the schedule', async () => {
    const Kit = require('../src/models/Kit');
    Kit.findById.mockReturnValue({ lean: () => Promise.resolve(baseKit) });
    Kit.findByIdAndUpdate.mockResolvedValue({});

    const buildSchedule = require('../src/kits/stages/buildSchedule');
    await buildSchedule('kit123');

    const schedule = Kit.findByIdAndUpdate.mock.calls[0][1]['results.schedule'];
    const allAssigned = schedule.days.flatMap((d) => d.question_ids);
    expect(allAssigned).toHaveLength(3);
    expect(new Set(allAssigned).size).toBe(3);
  });
});
