// Stage handler — deterministic schedule allocation.
// Reads questions + requirements + days from MongoDB.
// Allocates, validates, persists. No LLM. No network.

const Kit = require('../../models/Kit');
const {
  buildScheduleAllocation,
  validateSchedule,
} = require('./buildSchedule/scheduleAllocator');

const { isRegenerationSection, assertRegenerationBaseline, reloadKitForConcurrencyCheck } = require('../regenerationContext');

async function buildSchedule(kitId) {
  const kit = await Kit.findById(kitId).lean();
  const isQuestionRegen = isRegenerationSection(kit, 'questions');

  // Idempotency: skip if schedule already persisted (not during question regeneration).
  if (
    !isQuestionRegen &&
    kit.stages?.['build-schedule']?.status === 'done' &&
    kit.results?.schedule
  ) {
    return;
  }

  assertRegenerationBaseline(kit);

  const questions = kit.results?.questions || [];
  const requirements = kit.results?.requirements?.items || [];
  const days = kit.input?.days;

  if (!days || typeof days !== 'number' || days < 1) {
    throw new Error(`Invalid days value in kit input: ${days}`);
  }

  // Build allocation (pure, deterministic)
  const schedule = buildScheduleAllocation(questions, requirements, days);

  // Validate before persisting — catches any allocation bug immediately
  validateSchedule(schedule, questions, days);

  await reloadKitForConcurrencyCheck(kitId);

  await Kit.findByIdAndUpdate(kitId, {
    'results.schedule': schedule,
  });
}

module.exports = buildSchedule;
