/**
 * Kit Builder — schedule mutations (MongoDB only).
 * No BullMQ, no LLM, no research.
 * Day count is immutable. Minutes are recalculated with V1 fixed rules.
 */

const Kit = require('../models/Kit');
const { persistKitMutation, withContentRevision } = require('./mutationPersist');
const { MINUTES_PER_QUESTION } = require('./stages/buildSchedule/scheduleAllocator');

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function getSchedule(kit) {
  const schedule = kit.results?.schedule;
  if (!schedule || !Array.isArray(schedule.days) || schedule.days.length === 0) {
    throw httpError(409, 'Kit has no schedule to edit yet');
  }
  return schedule;
}

function expectedDayCount(schedule, kit) {
  // Prefer the persisted schedule contract; fall back to kit input days.
  if (Number.isInteger(schedule.days_available) && schedule.days_available > 0) {
    return schedule.days_available;
  }
  if (Number.isInteger(kit.input?.days) && kit.input.days > 0) {
    return kit.input.days;
  }
  return schedule.days.length;
}

function assertDayCountImmutable(schedule, kit) {
  const expected = expectedDayCount(schedule, kit);
  if (schedule.days.length !== expected) {
    throw httpError(
      409,
      `Schedule day count is corrupted: expected ${expected} days, found ${schedule.days.length}`
    );
  }
  return expected;
}

function cloneSchedule(schedule) {
  return {
    ...schedule,
    days: schedule.days.map((day) => ({
      ...day,
      question_ids: Array.isArray(day.question_ids) ? [...day.question_ids] : [],
    })),
  };
}

function findDayIndex(schedule, dayNumber) {
  if (!Number.isInteger(dayNumber) || dayNumber < 1) {
    throw httpError(400, 'Day number must be a positive integer');
  }
  const index = schedule.days.findIndex((d) => d.day === dayNumber);
  if (index === -1) {
    throw httpError(400, `Invalid day: ${dayNumber}`);
  }
  return index;
}

function knownQuestionIds(kit) {
  const questions = kit.results?.questions;
  return new Set(Array.isArray(questions) ? questions.map((q) => q.id) : []);
}

function assertQuestionExists(questionId, knownIds) {
  if (typeof questionId !== 'string' || questionId.trim() === '') {
    throw httpError(400, 'questionId must be a non-empty string');
  }
  if (!knownIds.has(questionId)) {
    throw httpError(400, `Unknown question id: "${questionId}"`);
  }
}

/**
 * V1 fixed minutes: one slot costs MINUTES_PER_QUESTION.
 * Frontend cannot supply arbitrary minutes.
 */
function recalculateDayMinutes(day) {
  const count = Array.isArray(day.question_ids) ? day.question_ids.length : 0;
  day.minutes = count * MINUTES_PER_QUESTION;
  return day;
}

function findQuestionDayIndex(schedule, questionId) {
  for (let i = 0; i < schedule.days.length; i++) {
    const ids = schedule.days[i].question_ids || [];
    const pos = ids.indexOf(questionId);
    if (pos !== -1) {
      return { dayIndex: i, position: pos };
    }
  }
  return null;
}

function assertNoDuplicateQuestions(schedule) {
  const seen = new Set();
  for (const day of schedule.days) {
    for (const qid of day.question_ids || []) {
      if (seen.has(qid)) {
        throw httpError(400, `Question "${qid}" appears in multiple days`);
      }
      seen.add(qid);
    }
  }
}

function buildPersistPayload(kit, schedule) {
  const update = {
    'results.schedule': schedule,
  };

  if (kit.data && typeof kit.data === 'object') {
    update.data = {
      ...kit.data,
      schedule,
    };
  }

  return update;
}

async function persistScheduleMutation(kitId, update) {
  const updated = await persistKitMutation(kitId, update);
  return withContentRevision(updated, {
    schedule: updated.results?.schedule || null,
  });
}

/**
 * Move a question from its current day to another existing day.
 * Body: { questionId, toDay, index? }
 */
async function moveQuestion(kitId, body) {
  const kit = await Kit.findById(kitId).lean();
  if (!kit) throw httpError(404, 'Kit not found');

  const schedule = cloneSchedule(getSchedule(kit));
  const dayCount = assertDayCountImmutable(schedule, kit);
  const knownIds = knownQuestionIds(kit);

  const questionId = body?.questionId;
  const toDay = body?.toDay;
  assertQuestionExists(questionId, knownIds);

  const toDayIndex = findDayIndex(schedule, toDay);
  const located = findQuestionDayIndex(schedule, questionId);
  if (!located) {
    throw httpError(400, `Question "${questionId}" is not scheduled on any day`);
  }

  const { dayIndex: fromDayIndex, position: fromPos } = located;

  // Remove from source day
  schedule.days[fromDayIndex].question_ids.splice(fromPos, 1);

  // Insert into target day.
  // `index` is the position in the target list AFTER the question has been
  // removed from its source (including same-day moves).
  const targetIds = schedule.days[toDayIndex].question_ids;
  let insertIndex = targetIds.length;
  if (body.index !== undefined) {
    if (!Number.isInteger(body.index) || body.index < 0 || body.index > targetIds.length) {
      throw httpError(
        400,
        `Invalid index. Must be an integer between 0 and ${targetIds.length}`
      );
    }
    insertIndex = body.index;
  }

  targetIds.splice(insertIndex, 0, questionId);

  recalculateDayMinutes(schedule.days[fromDayIndex]);
  recalculateDayMinutes(schedule.days[toDayIndex]);

  assertNoDuplicateQuestions(schedule);

  if (schedule.days.length !== dayCount) {
    throw httpError(500, 'Schedule day count changed unexpectedly');
  }
  schedule.days_available = dayCount;

  const update = buildPersistPayload(kit, schedule);
  return persistScheduleMutation(kitId, update);
}

/**
 * Reorder questions within a single day.
 * Body: { orderedIds: string[] }
 */
async function reorderDayQuestions(kitId, dayNumber, orderedIds) {
  const kit = await Kit.findById(kitId).lean();
  if (!kit) throw httpError(404, 'Kit not found');

  const schedule = cloneSchedule(getSchedule(kit));
  const dayCount = assertDayCountImmutable(schedule, kit);
  const dayIndex = findDayIndex(schedule, dayNumber);
  const day = schedule.days[dayIndex];
  const currentIds = day.question_ids || [];

  if (!Array.isArray(orderedIds)) {
    throw httpError(400, 'orderedIds must be an array of question ids');
  }
  if (orderedIds.length !== currentIds.length) {
    throw httpError(400, 'orderedIds must include every question on this day exactly once');
  }

  const currentSet = new Set(currentIds);
  const seen = new Set();
  for (const id of orderedIds) {
    if (seen.has(id)) {
      throw httpError(400, `Duplicate question id in orderedIds: "${id}"`);
    }
    seen.add(id);
    if (!currentSet.has(id)) {
      throw httpError(400, `Question "${id}" is not on day ${dayNumber}`);
    }
  }

  day.question_ids = [...orderedIds];
  recalculateDayMinutes(day); // same count — minutes unchanged, but keep authoritative

  assertNoDuplicateQuestions(schedule);
  if (schedule.days.length !== dayCount) {
    throw httpError(500, 'Schedule day count changed unexpectedly');
  }
  schedule.days_available = dayCount;

  const update = buildPersistPayload(kit, schedule);
  return persistScheduleMutation(kitId, update);
}

/**
 * Update a day's focus label only.
 * Body: { focus: string }
 */
async function updateDayFocus(kitId, dayNumber, body) {
  const kit = await Kit.findById(kitId).lean();
  if (!kit) throw httpError(404, 'Kit not found');

  const schedule = cloneSchedule(getSchedule(kit));
  const dayCount = assertDayCountImmutable(schedule, kit);
  const dayIndex = findDayIndex(schedule, dayNumber);

  if (typeof body?.focus !== 'string' || body.focus.trim() === '') {
    throw httpError(400, 'focus must be a non-empty string');
  }

  schedule.days[dayIndex].focus = body.focus.trim();
  schedule.days_available = dayCount;

  const update = buildPersistPayload(kit, schedule);
  return persistScheduleMutation(kitId, update);
}

module.exports = {
  moveQuestion,
  reorderDayQuestions,
  updateDayFocus,
  // exported for unit tests
  recalculateDayMinutes,
  httpError,
  MINUTES_PER_QUESTION,
};
