// Final Appendix A contract gate.
// This validator is designed for assembly integrity, not re-validation
// of every field — per-field validation already happened in each stage.
//
// What it checks:
//   1. All required top-level sections are present
//   2. Required field names inside sections are present (not renamed)
//   3. Cross-reference integrity: question IDs in schedule exist in questions;
//      flashcard requirement_ids exist in requirements
//   4. coverage.uncovered_requirement_ids is empty (must-haves all covered)
//   5. schedule.days.length === schedule.days_available
//
// Any failure throws a structured error — the stage fails and BullMQ
// retries. An incomplete kit is never silently persisted.

const { VALID_CATEGORIES } = require('./stages/generateQuestions/questionSchemaValidator');

const REQUIRED_TOP_LEVEL = ['source', 'company_brief', 'role', 'questions', 'flashcards', 'schedule', 'coverage'];

const REQUIRED_SOURCE_FIELDS = ['company', 'company_url', 'role', 'location', 'jd_chars', 'researched_at', 'pages_used'];
const REQUIRED_BRIEF_FIELDS = ['summary', 'what_they_do', 'sources'];
const REQUIRED_ROLE_FIELDS = ['title', 'seniority', 'responsibilities', 'requirements'];
const REQUIRED_COVERAGE_FIELDS = ['uncovered_requirement_ids', 'passes'];
const REQUIRED_SCHEDULE_FIELDS = ['days_available', 'days'];

function assertFields(obj, fields, context) {
  for (const field of fields) {
    if (!(field in obj)) {
      throw new Error(`${context}: missing required field "${field}"`);
    }
  }
}

function validateQuestionContract(question, index, knownRequirementIds, errors) {
  const ctx = `questions[${index}]`;

  if (question.question !== undefined) {
    errors.push(`${ctx}: legacy "question" field is not allowed; use "prompt"`);
  }

  if (typeof question.prompt !== 'string' || question.prompt.trim() === '') {
    errors.push(`${ctx}: missing or empty "prompt"`);
  }

  if (typeof question.answer_outline !== 'string' || question.answer_outline.trim() === '') {
    errors.push(`${ctx}: missing or empty "answer_outline"`);
  }

  if (!VALID_CATEGORIES.includes(question.category)) {
    errors.push(`${ctx}: invalid category "${question.category}"`);
  }

  if (!Number.isInteger(question.difficulty) || question.difficulty < 1 || question.difficulty > 3) {
    errors.push(`${ctx}: difficulty must be 1, 2, or 3`);
  }

  if (!Array.isArray(question.requirement_ids)) {
    errors.push(`${ctx}: requirement_ids must be an array`);
    return;
  }

  for (const rid of question.requirement_ids) {
    if (!knownRequirementIds.has(rid)) {
      errors.push(`${ctx}: references unknown requirement_id: "${rid}"`);
    }
  }
}

function validateKitStructure(kit) {
  const errors = [];

  // 1. Top-level sections
  for (const key of REQUIRED_TOP_LEVEL) {
    if (!(key in kit) || kit[key] === null || kit[key] === undefined) {
      errors.push(`Missing required top-level section: "${key}"`);
    }
  }
  if (errors.length > 0) {
    throw new Error(`Kit structure validation failed:\n${errors.map((e) => `  ${e}`).join('\n')}`);
  }

  // 2. Required field names inside each section
  try { assertFields(kit.source, REQUIRED_SOURCE_FIELDS, 'source'); } catch (e) { errors.push(e.message); }
  try { assertFields(kit.company_brief, REQUIRED_BRIEF_FIELDS, 'company_brief'); } catch (e) { errors.push(e.message); }
  try { assertFields(kit.role, REQUIRED_ROLE_FIELDS, 'role'); } catch (e) { errors.push(e.message); }
  try { assertFields(kit.coverage, REQUIRED_COVERAGE_FIELDS, 'coverage'); } catch (e) { errors.push(e.message); }
  try { assertFields(kit.schedule, REQUIRED_SCHEDULE_FIELDS, 'schedule'); } catch (e) { errors.push(e.message); }

  if (!Array.isArray(kit.questions)) errors.push('"questions" must be an array');
  if (!Array.isArray(kit.flashcards)) errors.push('"flashcards" must be an array');
  if (!Array.isArray(kit.schedule?.days)) errors.push('"schedule.days" must be an array');
  if (!Array.isArray(kit.role?.requirements)) errors.push('"role.requirements" must be an array');
  if (!Array.isArray(kit.coverage?.uncovered_requirement_ids)) {
    errors.push('"coverage.uncovered_requirement_ids" must be an array');
  }

  if (errors.length > 0) {
    throw new Error(`Kit structure validation failed:\n${errors.map((e) => `  ${e}`).join('\n')}`);
  }

  // 3. Cross-reference integrity
  const knownQuestionIds = new Set(kit.questions.map((q) => q.id));
  const knownRequirementIds = new Set((kit.role.requirements || []).map((r) => r.id));

  // Schedule question_ids must reference existing questions
  for (const day of kit.schedule.days) {
    for (const qid of day.question_ids || []) {
      if (!knownQuestionIds.has(qid)) {
        errors.push(`schedule day ${day.day} references unknown question_id: "${qid}"`);
      }
    }
  }

  // Question Appendix A contract + requirement reference integrity
  for (let i = 0; i < kit.questions.length; i++) {
    validateQuestionContract(kit.questions[i], i, knownRequirementIds, errors);
  }

  // Flashcard requirement_ids must reference existing requirements
  for (let i = 0; i < kit.flashcards.length; i++) {
    for (const rid of kit.flashcards[i].requirement_ids || []) {
      if (!knownRequirementIds.has(rid)) {
        errors.push(`flashcards[${i}] references unknown requirement_id: "${rid}"`);
      }
    }
  }

  // 4. No uncovered must-have requirements
  if (kit.coverage.uncovered_requirement_ids.length > 0) {
    const ids = kit.coverage.uncovered_requirement_ids.join(', ');
    errors.push(`coverage.uncovered_requirement_ids is non-empty: [${ids}]. Must-have requirements are not fully covered.`);
  }

  // 5. Schedule day count matches days_available
  if (kit.schedule.days.length !== kit.schedule.days_available) {
    errors.push(
      `schedule.days has ${kit.schedule.days.length} entries but days_available is ${kit.schedule.days_available}`
    );
  }

  if (errors.length > 0) {
    throw new Error(`Kit integrity validation failed:\n${errors.map((e) => `  ${e}`).join('\n')}`);
  }
}

module.exports = { validateKitStructure };
