/**
 * Kit Builder — question mutations (MongoDB only).
 * No BullMQ, no LLM, no research.
 */

const Kit = require('../models/Kit');
const { persistKitMutation, withContentRevision } = require('./mutationPersist');
const { VALID_CATEGORIES } = require('./stages/generateQuestions/questionSchemaValidator');
const {
  countQuestionsByRequirement,
  computeUncoveredMustHaves,
} = require('./stages/checkCoverage/coverageCalculator');
const { withUserState, markEdited, normalizeContentState } = require('./contentState');

const DEFAULT_MINUTES = 15;

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function getQuestions(kit) {
  const questions = kit.results?.questions;
  if (!Array.isArray(questions)) {
    throw httpError(409, 'Kit has no questions to edit yet');
  }
  return questions;
}

function knownRequirementIds(kit) {
  const items = kit.results?.requirements?.items;
  return new Set(Array.isArray(items) ? items.map((r) => r.id) : []);
}

function nextQuestionId(questions) {
  let max = 0;
  for (const q of questions) {
    const match = typeof q.id === 'string' ? /^q(\d+)$/.exec(q.id) : null;
    if (match) {
      max = Math.max(max, parseInt(match[1], 10));
    }
  }
  return `q${max + 1}`;
}

function validatePrompt(prompt) {
  if (typeof prompt !== 'string' || prompt.trim() === '') {
    throw httpError(400, 'Question prompt must be a non-empty string');
  }
  return prompt.trim();
}

function validateCategory(category) {
  if (!VALID_CATEGORIES.includes(category)) {
    throw httpError(400, `Invalid category. Must be one of: ${VALID_CATEGORIES.join(', ')}`);
  }
  return category;
}

function validateDifficulty(difficulty) {
  if (!Number.isInteger(difficulty) || difficulty < 1 || difficulty > 3) {
    throw httpError(400, 'Difficulty must be an integer 1, 2, or 3');
  }
  return difficulty;
}

function validateMinutes(minutes) {
  if (minutes === undefined) return DEFAULT_MINUTES;
  if (!Number.isInteger(minutes) || minutes < 1) {
    throw httpError(400, 'Minutes must be a positive integer');
  }
  return minutes;
}

function validateRequirementIds(requirementIds, knownIds) {
  if (requirementIds === undefined) return undefined;
  if (!Array.isArray(requirementIds)) {
    throw httpError(400, 'requirement_ids must be an array of strings');
  }
  for (const id of requirementIds) {
    if (typeof id !== 'string' || id.trim() === '') {
      throw httpError(400, 'requirement_ids must contain only non-empty strings');
    }
    if (!knownIds.has(id)) {
      throw httpError(400, `Unknown requirement id: "${id}"`);
    }
  }
  // Preserve order, drop duplicates
  return [...new Set(requirementIds)];
}

function findQuestionIndex(questions, questionId) {
  const index = questions.findIndex((q) => q.id === questionId);
  if (index === -1) {
    throw httpError(404, 'Question not found');
  }
  return index;
}

function recomputeCoverage(requirements, questions, existingCoverage) {
  const items = Array.isArray(requirements?.items) ? requirements.items : [];
  const questionCounts = countQuestionsByRequirement(questions || []);
  const uncoveredIds = computeUncoveredMustHaves(items, questionCounts);
  return {
    uncovered_requirement_ids: uncoveredIds,
    passes: existingCoverage?.passes ?? 0,
  };
}

/**
 * Remove a question id from every schedule day. Day count stays immutable.
 */
function detachQuestionFromSchedule(schedule, questionId) {
  if (!schedule || typeof schedule !== 'object') return schedule;
  const days = Array.isArray(schedule.days)
    ? schedule.days.map((day) => ({
        ...day,
        question_ids: Array.isArray(day.question_ids)
          ? day.question_ids.filter((id) => id !== questionId)
          : [],
      }))
    : schedule.days;
  return { ...schedule, days };
}

function buildPersistPayload(kit, { questions, schedule, coverage }) {
  const update = {
    'results.questions': questions,
    'results.coverage': coverage,
  };

  if (schedule !== undefined) {
    update['results.schedule'] = schedule;
  }

  if (kit.data && typeof kit.data === 'object') {
    update.data = {
      ...kit.data,
      questions,
      coverage,
      ...(schedule !== undefined ? { schedule } : {}),
    };
  }

  return update;
}

async function persistQuestionMutation(kitId, update) {
  const updated = await persistKitMutation(kitId, update);
  return withContentRevision(updated, {
    questions: updated.results?.questions || [],
    coverage: updated.results?.coverage || {
      uncovered_requirement_ids: [],
      passes: 0,
    },
    schedule: updated.results?.schedule || null,
  });
}

/**
 * Apply prompt onto a question while keeping legacy `question` in sync.
 */
function applyPrompt(target, prompt) {
  target.prompt = prompt;
  target.question = prompt; // backward compatible with pipeline readers
}

async function updateQuestion(kitId, questionId, patch) {
  const kit = await Kit.findById(kitId).lean();
  if (!kit) throw httpError(404, 'Kit not found');

  const questions = getQuestions(kit).map((q) => ({ ...q }));
  const index = findQuestionIndex(questions, questionId);
  let current = questions[index];
  const knownIds = knownRequirementIds(kit);

  if (patch.id !== undefined && patch.id !== questionId) {
    throw httpError(400, 'Question id cannot be changed');
  }

  let changed = false;

  // Accept prompt (preferred) or legacy question alias
  const promptValue = patch.prompt !== undefined ? patch.prompt : patch.question;
  if (promptValue !== undefined) {
    applyPrompt(current, validatePrompt(promptValue));
    changed = true;
  }

  if (patch.answer_outline !== undefined) {
    if (typeof patch.answer_outline !== 'string') {
      throw httpError(400, 'answer_outline must be a string');
    }
    current.answer_outline = patch.answer_outline;
    changed = true;
  }

  if (patch.category !== undefined) {
    current.category = validateCategory(patch.category);
    changed = true;
  }

  if (patch.difficulty !== undefined) {
    current.difficulty = validateDifficulty(patch.difficulty);
    changed = true;
  }

  if (patch.minutes !== undefined) {
    current.minutes = validateMinutes(patch.minutes);
    changed = true;
  }

  if (patch.requirement_ids !== undefined) {
    current.requirement_ids = validateRequirementIds(patch.requirement_ids, knownIds);
    changed = true;
  }

  if (changed) {
    current = markEdited(current);
  } else {
    // Ensure legacy rows still expose normalized state on read-back paths
    const state = normalizeContentState(current);
    current = { ...current, ...state };
  }

  questions[index] = current;

  const coverage = recomputeCoverage(
    kit.results?.requirements,
    questions,
    kit.results?.coverage
  );
  const update = buildPersistPayload(kit, { questions, coverage });
  return persistQuestionMutation(kitId, update);
}

async function addQuestion(kitId, body) {
  const kit = await Kit.findById(kitId).lean();
  if (!kit) throw httpError(404, 'Kit not found');

  // Questions array may be empty after a thin JD, but must exist (or we allow creating it
  // only after generation has at least initialized results.questions).
  if (!Array.isArray(kit.results?.questions)) {
    throw httpError(409, 'Kit has no questions to edit yet');
  }

  const questions = kit.results.questions.map((q) => ({ ...q }));
  const knownIds = knownRequirementIds(kit);

  const prompt = validatePrompt(body.prompt !== undefined ? body.prompt : body.question);
  const category = validateCategory(body.category);
  const difficulty = validateDifficulty(body.difficulty);
  const minutes = validateMinutes(body.minutes);
  const requirementIds = validateRequirementIds(body.requirement_ids ?? [], knownIds);

  if (body.answer_outline !== undefined && typeof body.answer_outline !== 'string') {
    throw httpError(400, 'answer_outline must be a string');
  }

  const id = nextQuestionId(questions);
  if (questions.some((q) => q.id === id)) {
    throw httpError(500, 'Failed to allocate a unique question id');
  }

  const newQuestion = withUserState({
    id,
    prompt,
    question: prompt,
    answer_outline: typeof body.answer_outline === 'string' ? body.answer_outline : '',
    category,
    difficulty,
    minutes,
    requirement_ids: requirementIds,
  });

  let insertIndex = questions.length;
  if (body.index !== undefined) {
    if (!Number.isInteger(body.index) || body.index < 0 || body.index > questions.length) {
      throw httpError(400, `Invalid index. Must be an integer between 0 and ${questions.length}`);
    }
    insertIndex = body.index;
  }

  questions.splice(insertIndex, 0, newQuestion);

  // New questions are unscheduled — do not modify schedule.
  const coverage = recomputeCoverage(
    kit.results?.requirements,
    questions,
    kit.results?.coverage
  );
  const update = buildPersistPayload(kit, { questions, coverage });
  const result = await persistQuestionMutation(kitId, update);
  return { ...result, question: newQuestion };
}

async function deleteQuestion(kitId, questionId) {
  const kit = await Kit.findById(kitId).lean();
  if (!kit) throw httpError(404, 'Kit not found');

  const questions = getQuestions(kit).map((q) => ({ ...q }));
  findQuestionIndex(questions, questionId);

  const nextQuestions = questions.filter((q) => q.id !== questionId);
  const schedule = detachQuestionFromSchedule(kit.results?.schedule, questionId);
  const coverage = recomputeCoverage(
    kit.results?.requirements,
    nextQuestions,
    kit.results?.coverage
  );

  const update = buildPersistPayload(kit, {
    questions: nextQuestions,
    schedule,
    coverage,
  });
  return persistQuestionMutation(kitId, update);
}

async function reorderQuestions(kitId, orderedIds) {
  const kit = await Kit.findById(kitId).lean();
  if (!kit) throw httpError(404, 'Kit not found');

  const questions = getQuestions(kit);
  if (!Array.isArray(orderedIds)) {
    throw httpError(400, 'orderedIds must be an array of question ids');
  }
  if (orderedIds.length !== questions.length) {
    throw httpError(400, 'orderedIds must include every question id exactly once');
  }

  const byId = new Map(questions.map((q) => [q.id, q]));
  const seen = new Set();
  const reordered = [];

  for (const id of orderedIds) {
    if (seen.has(id)) {
      throw httpError(400, `Duplicate question id in orderedIds: "${id}"`);
    }
    seen.add(id);
    const item = byId.get(id);
    if (!item) {
      throw httpError(400, `Unknown question id in orderedIds: "${id}"`);
    }
    reordered.push({ ...item });
  }

  // Reorder does not change coverage or schedule.
  const coverage = recomputeCoverage(
    kit.results?.requirements,
    reordered,
    kit.results?.coverage
  );
  const update = buildPersistPayload(kit, { questions: reordered, coverage });
  return persistQuestionMutation(kitId, update);
}

module.exports = {
  updateQuestion,
  addQuestion,
  deleteQuestion,
  reorderQuestions,
  // exported for unit tests
  nextQuestionId,
  recomputeCoverage,
  detachQuestionFromSchedule,
  httpError,
  VALID_CATEGORIES,
};
