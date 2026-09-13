const {
  buildScheduleAllocation,
  validateSchedule,
  MINUTES_PER_QUESTION,
} = require('../src/kits/stages/buildSchedule/scheduleAllocator');

// ─── helpers ─────────────────────────────────────────────────────────────────

function makeRequirements(defs) {
  return defs.map(([id, priority]) => ({ id, priority, kind: 'technical', text: id }));
}

function makeQuestion(id, reqIds, difficulty = 2, category = 'technical') {
  return { id, requirement_ids: reqIds, difficulty, category };
}

/**
 * Flatten all question_ids from the schedule preserving day order.
 */
function flattenScheduledIds(schedule) {
  return schedule.days.flatMap((d) => d.question_ids);
}

/**
 * Integrity assertions used across all edge-case tests.
 * Verifies exact day count, no duplicates, no lost questions, valid day shape.
 */
function assertScheduleIntegrity(schedule, questions, requestedDays) {
  expect(schedule.days_available).toBe(requestedDays);
  expect(schedule.days).toHaveLength(requestedDays);

  const scheduledIds = flattenScheduledIds(schedule);
  const inputIds = questions.map((q) => q.id);

  // Exact multiplicity — every input question appears exactly once
  expect(scheduledIds).toHaveLength(inputIds.length);
  expect([...scheduledIds].sort()).toEqual([...inputIds].sort());
  expect(new Set(scheduledIds).size).toBe(scheduledIds.length);

  for (let i = 0; i < schedule.days.length; i++) {
    const day = schedule.days[i];
    expect(day.day).toBe(i + 1);
    expect(Array.isArray(day.question_ids)).toBe(true);
    expect(typeof day.minutes).toBe('number');
    expect(typeof day.focus).toBe('string');
    expect(day.minutes).toBe(day.question_ids.length * MINUTES_PER_QUESTION);

    if (day.question_ids.length === 0) {
      expect(day.focus).toBe('rest');
      expect(day.minutes).toBe(0);
    }
  }

  // Built-in validator must also pass
  validateSchedule(schedule, questions, requestedDays);
}

/**
 * Within each day, round-robin assigns from a difficulty-sorted list so
 * earlier slots on a day should not be easier than later slots on that day.
 */
function assertWithinDayDifficultyOrder(schedule, questionMap) {
  for (const day of schedule.days) {
    const diffs = day.question_ids.map((id) => questionMap.get(id)?.difficulty ?? 1);
    for (let i = 1; i < diffs.length; i++) {
      expect(diffs[i]).toBeLessThanOrEqual(diffs[i - 1]);
    }
  }
}

/**
 * Phase-1 must questions are allocated before phase-2 nice questions.
 * Within each day, must-linked IDs precede nice-only IDs in question_ids.
 */
function assertMustBeforeNiceWithinDays(schedule, questions, requirements) {
  const mustReqIds = new Set(
    requirements.filter((r) => r.priority === 'must').map((r) => r.id)
  );

  const isMustQ = (id) => {
    const q = questions.find((x) => x.id === id);
    return (q?.requirement_ids || []).some((rid) => mustReqIds.has(rid));
  };

  for (const day of schedule.days) {
    let seenNice = false;
    for (const qid of day.question_ids) {
      if (!isMustQ(qid)) seenNice = true;
      if (seenNice && isMustQ(qid)) {
        throw new Error(`Must question ${qid} appears after nice on day ${day.day}`);
      }
    }
  }
}

// ─── edge cases ──────────────────────────────────────────────────────────────

describe('buildScheduleAllocation edge cases', () => {
  const baseRequirements = makeRequirements([
    ['r1', 'must'],
    ['r2', 'must'],
    ['r3', 'nice'],
  ]);

  describe('1 day', () => {
    test('allocates all questions to day 1', () => {
      const questions = [
        makeQuestion('q1', ['r1'], 3),
        makeQuestion('q2', ['r2'], 2),
        makeQuestion('q3', ['r3'], 1),
      ];
      const schedule = buildScheduleAllocation(questions, baseRequirements, 1);

      assertScheduleIntegrity(schedule, questions, 1);
      expect(schedule.days[0].question_ids).toHaveLength(3);
      expect(schedule.days[0].question_ids).toEqual(
        expect.arrayContaining(['q1', 'q2', 'q3'])
      );
    });
  });

  describe('5 days', () => {
    test('returns exactly 5 days with normal round-robin distribution', () => {
      const questions = Array.from({ length: 8 }, (_, i) =>
        makeQuestion(`q${i + 1}`, i % 2 === 0 ? ['r1'] : ['r3'], (i % 3) + 1)
      );
      const schedule = buildScheduleAllocation(questions, baseRequirements, 5);

      assertScheduleIntegrity(schedule, questions, 5);

      // Must phase then nice phase — both round-robin from day 1.
      // 4 must + 4 nice → days 1–4 each get 2, day 5 may be empty.
      const counts = schedule.days.map((d) => d.question_ids.length);
      expect(counts.reduce((a, b) => a + b, 0)).toBe(8);
      expect(Math.max(...counts)).toBeLessThanOrEqual(2);
      expect(counts.filter((c) => c > 0).length).toBeGreaterThanOrEqual(4);
    });
  });

  describe('60 days', () => {
    test('returns exactly 60 day objects without inventing questions', () => {
      const questions = Array.from({ length: 10 }, (_, i) =>
        makeQuestion(`q${i + 1}`, ['r1'], 2)
      );
      const schedule = buildScheduleAllocation(questions, baseRequirements, 60);

      assertScheduleIntegrity(schedule, questions, 60);

      const daysWithQuestions = schedule.days.filter((d) => d.question_ids.length > 0);
      const restDays = schedule.days.filter((d) => d.question_ids.length === 0);

      expect(daysWithQuestions).toHaveLength(10);
      expect(restDays).toHaveLength(50);
      expect(restDays.every((d) => d.focus === 'rest' && d.minutes === 0)).toBe(true);
    });
  });

  describe('more days than questions', () => {
    test('3 questions across 10 days — all appear once, rest days empty', () => {
      const questions = [
        makeQuestion('q1', ['r1'], 3),
        makeQuestion('q2', ['r2'], 2),
        makeQuestion('q3', ['r3'], 1),
      ];
      const schedule = buildScheduleAllocation(questions, baseRequirements, 10);

      assertScheduleIntegrity(schedule, questions, 10);

      // 2 must spread across days 1–2, then 1 nice added to day 1.
      const nonEmpty = schedule.days.filter((d) => d.question_ids.length > 0);
      expect(nonEmpty).toHaveLength(2);
      expect(schedule.days[0].question_ids).toEqual(expect.arrayContaining(['q1', 'q3']));
      expect(schedule.days[1].question_ids).toEqual(['q2']);
      expect(schedule.days.slice(2).every((d) => d.question_ids.length === 0)).toBe(true);
    });
  });

  describe('more questions than days', () => {
    test('20 questions across 5 days — all allocated, no day empty', () => {
      const questions = Array.from({ length: 20 }, (_, i) =>
        makeQuestion(`q${i + 1}`, i < 12 ? ['r1'] : ['r3'], (i % 3) + 1)
      );
      const schedule = buildScheduleAllocation(questions, baseRequirements, 5);

      assertScheduleIntegrity(schedule, questions, 5);

      // 12 must (3,3,2,2,2) + 8 nice (2,2,2,1,1) → every day has questions
      const counts = schedule.days.map((d) => d.question_ids.length);
      expect(counts.reduce((a, b) => a + b, 0)).toBe(20);
      expect(counts.every((c) => c > 0)).toBe(true);
    });
  });

  describe('zero questions', () => {
    test('returns N valid rest days with zero minutes', () => {
      const questions = [];
      const schedule = buildScheduleAllocation(questions, baseRequirements, 7);

      assertScheduleIntegrity(schedule, questions, 7);
      expect(schedule.days.every((d) => d.question_ids.length === 0)).toBe(true);
      expect(schedule.days.every((d) => d.minutes === 0 && d.focus === 'rest')).toBe(true);
    });
  });

  describe('must + nice mixture', () => {
    test('must-linked questions appear on earlier days than nice-only questions', () => {
      const questions = [
        makeQuestion('q_must1', ['r1'], 3),
        makeQuestion('q_must2', ['r2'], 2),
        makeQuestion('q_nice1', ['r3'], 3),
        makeQuestion('q_nice2', ['r3'], 1),
      ];
      const schedule = buildScheduleAllocation(questions, baseRequirements, 4);

      assertScheduleIntegrity(schedule, questions, 4);
      assertMustBeforeNiceWithinDays(schedule, questions, baseRequirements);

      // Must phase fills days 1–2 before nice phase adds to days 1–2
      expect(schedule.days[0].question_ids[0]).toBe('q_must1');
      expect(schedule.days[1].question_ids[0]).toBe('q_must2');
    });
  });

  describe('difficulty ordering', () => {
    test('harder questions land on earlier days; within-day order is non-increasing', () => {
      const questions = [
        makeQuestion('q1', ['r1'], 1),
        makeQuestion('q2', ['r1'], 2),
        makeQuestion('q3', ['r1'], 3),
        makeQuestion('q4', ['r1'], 3),
        makeQuestion('q5', ['r1'], 2),
        makeQuestion('q6', ['r1'], 1),
      ];
      const schedule = buildScheduleAllocation(questions, baseRequirements, 3);
      const questionMap = new Map(questions.map((q) => [q.id, q]));

      assertScheduleIntegrity(schedule, questions, 3);
      assertWithinDayDifficultyOrder(schedule, questionMap);

      // First question on each day (round-robin from sorted list) should be >= difficulty of
      // first question on later days when each day has at least one question
      const firstDifficulties = schedule.days
        .filter((d) => d.question_ids.length > 0)
        .map((d) => questionMap.get(d.question_ids[0]).difficulty);

      for (let i = 1; i < firstDifficulties.length; i++) {
        expect(firstDifficulties[i]).toBeLessThanOrEqual(firstDifficulties[i - 1]);
      }
    });
  });

  describe('determinism', () => {
    test('identical inputs produce identical output on repeated execution', () => {
      const questions = Array.from({ length: 12 }, (_, i) =>
        makeQuestion(`q${i + 1}`, i % 3 === 0 ? ['r1'] : ['r3'], (i % 3) + 1, 'behavioural')
      );

      const run1 = buildScheduleAllocation(questions, baseRequirements, 5);
      const run2 = buildScheduleAllocation(questions, baseRequirements, 5);
      const run3 = buildScheduleAllocation(questions, baseRequirements, 5);

      expect(run1).toEqual(run2);
      expect(run2).toEqual(run3);
    });
  });

  describe('integrity regression', () => {
    test('no duplicate or lost questions across varied configurations', () => {
      const configs = [
        { qCount: 1, days: 1 },
        { qCount: 3, days: 10 },
        { qCount: 20, days: 5 },
        { qCount: 0, days: 14 },
        { qCount: 15, days: 60 },
      ];

      for (const { qCount, days } of configs) {
        const questions = Array.from({ length: qCount }, (_, i) =>
          makeQuestion(`q${i + 1}`, i % 2 === 0 ? ['r1'] : ['r3'], (i % 3) + 1)
        );
        const schedule = buildScheduleAllocation(questions, baseRequirements, days);
        assertScheduleIntegrity(schedule, questions, days);
      }
    });

    test('every must requirement with linked questions remains represented', () => {
      const requirements = makeRequirements([
        ['r1', 'must'],
        ['r2', 'must'],
        ['r3', 'nice'],
      ]);
      const questions = [
        makeQuestion('q1', ['r1'], 2),
        makeQuestion('q2', ['r2'], 2),
        makeQuestion('q3', ['r3'], 1),
      ];
      const schedule = buildScheduleAllocation(questions, requirements, 3);
      const scheduledIds = new Set(flattenScheduledIds(schedule));

      for (const req of requirements.filter((r) => r.priority === 'must')) {
        const linked = questions.filter((q) => q.requirement_ids.includes(req.id));
        expect(linked.some((q) => scheduledIds.has(q.id))).toBe(true);
      }
    });
  });
});
