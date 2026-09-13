// Pure schedule allocation functions.
// No MongoDB, no side effects, no LLM — exported separately so every
// allocation rule can be unit tested in isolation.

const MINUTES_PER_QUESTION = parseInt(process.env.MINUTES_PER_QUESTION || '15', 10);

// Splits questions into must-have and nice buckets based on whether any of
// a question's requirement_ids maps to a must-have requirement.
function splitQuestions(questions, requirements) {
  const mustHaveReqIds = new Set(
    requirements.filter((r) => r.priority === 'must').map((r) => r.id)
  );

  const must = [];
  const nice = [];

  for (const q of questions) {
    const isMust = (q.requirement_ids || []).some((id) => mustHaveReqIds.has(id));
    if (isMust) {
      must.push(q);
    } else {
      nice.push(q);
    }
  }

  return { must, nice };
}

// Sorts must questions by difficulty descending so harder questions are
// spread across earlier days when allocated via round-robin.
function sortByDifficultyDesc(questions) {
  return [...questions].sort((a, b) => (b.difficulty || 1) - (a.difficulty || 1));
}

// Round-robin distribution across N day buckets.
// Fills one question per day in order, cycling back to day 0 when all days
// have received one question, then repeating until all questions assigned.
// This spreads difficulty evenly rather than concentrating hard questions on day 1.
function distributeRoundRobin(questions, dayBuckets) {
  for (let i = 0; i < questions.length; i++) {
    const bucket = dayBuckets[i % dayBuckets.length];
    bucket.question_ids.push(questions[i].id);
    bucket.minutes += MINUTES_PER_QUESTION;
  }
}

// Derives a focus label for a day from the dominant category of its questions.
// If a day has no questions, returns 'rest'.
function deriveFocus(questionIds, questionMap) {
  if (questionIds.length === 0) return 'rest';

  const counts = {};
  for (const qid of questionIds) {
    const cat = questionMap.get(qid)?.category || 'general';
    counts[cat] = (counts[cat] || 0) + 1;
  }

  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
}

// Main allocation function. Returns the schedule in Appendix A shape.
// Always returns exactly `days` entries even if some are empty.
function buildScheduleAllocation(questions, requirements, days) {
  if (days < 1) {
    throw new Error(`days must be a positive integer, got: ${days}`);
  }

  // Initialise exactly N day buckets
  const dayBuckets = Array.from({ length: days }, (_, i) => ({
    day: i + 1,
    question_ids: [],
    minutes: 0,
    focus: 'rest', // overwritten below if questions are assigned
  }));

  if (questions.length === 0) {
    return { days_available: days, days: dayBuckets };
  }

  const { must, nice } = splitQuestions(questions, requirements);
  const sortedMust = sortByDifficultyDesc(must);
  // Nice questions are also sorted by difficulty so harder nice-to-haves
  // also land earlier in the rotation
  const sortedNice = sortByDifficultyDesc(nice);

  // Phase 1: distribute must-have questions via round-robin
  distributeRoundRobin(sortedMust, dayBuckets);

  // Phase 2: distribute nice questions via round-robin, continuing
  // from where phase 1 left off relative to which days have what.
  // Both phases use the same simple cycle — phase 2 starts fresh from
  // day 0 because by then must-haves are spread and we want nice-to-haves
  // to also start from day 1 rather than continuing from wherever the
  // must-have rotation ended (which could overload early days).
  distributeRoundRobin(sortedNice, dayBuckets);

  // Build a lookup map for focus derivation
  const questionMap = new Map(questions.map((q) => [q.id, q]));

  for (const bucket of dayBuckets) {
    bucket.focus = deriveFocus(bucket.question_ids, questionMap);
  }

  return { days_available: days, days: dayBuckets };
}

// Validates the built schedule before persistence:
//   - exactly N days
//   - every question_id in the schedule exists in the known question set
//   - no question is assigned more than once
//   - all questions are allocated (none left out)
function validateSchedule(schedule, questions, days) {
  const knownIds = new Set(questions.map((q) => q.id));
  const errors = [];

  if (schedule.days.length !== days) {
    errors.push(`Expected ${days} day entries, got ${schedule.days.length}`);
  }

  const assigned = new Set();
  const duplicates = [];

  for (const day of schedule.days) {
    for (const qid of day.question_ids) {
      if (!knownIds.has(qid)) {
        errors.push(`Day ${day.day} references unknown question_id: ${qid}`);
      }
      if (assigned.has(qid)) {
        duplicates.push(qid);
      }
      assigned.add(qid);
    }
  }

  if (duplicates.length > 0) {
    errors.push(`Duplicate question assignment: ${duplicates.join(', ')}`);
  }

  const unassigned = questions.filter((q) => !assigned.has(q.id)).map((q) => q.id);
  if (unassigned.length > 0) {
    errors.push(`Questions not allocated to any day: ${unassigned.join(', ')}`);
  }

  if (errors.length > 0) {
    throw new Error(`Schedule validation failed:\n${errors.map((e) => `  ${e}`).join('\n')}`);
  }
}

module.exports = {
  buildScheduleAllocation,
  validateSchedule,
  splitQuestions,
  sortByDifficultyDesc,
  distributeRoundRobin,
  deriveFocus,
  MINUTES_PER_QUESTION,
};
