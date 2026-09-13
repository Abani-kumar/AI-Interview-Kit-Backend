// Stage handler.
// One LLM call. No network I/O. No new research.
// Reads questions + requirements, generates flashcards, validates,
// assigns IDs in application code, persists.

const Kit = require('../../models/Kit');
const { getLLMClient } = require('../../llm/LLMClient');
const { withGeneratedState } = require('../contentState');
const {
  isRegenerationSection,
  assertRegenerationBaseline,
  terminalNextForRegeneration,
  reloadKitForConcurrencyCheck,
} = require('../regenerationContext');
const { mergeFlashcards } = require('../regenerationMerge');
const { SYSTEM_PROMPT, buildFlashcardsPrompt } = require('./generateFlashcards/flashcardPromptBuilder');
const { validateFlashcardsOutput } = require('./generateFlashcards/flashcardSchemaValidator');

async function generateFlashcards(kitId) {
  const kit = await Kit.findById(kitId).lean();
  const isFlashcardRegen = isRegenerationSection(kit, 'flashcards');
  const isQuestionRegen = isRegenerationSection(kit, 'questions');

  if (
    !isFlashcardRegen &&
    !isQuestionRegen &&
    kit.stages?.['generate-flashcards']?.status === 'done' &&
    Array.isArray(kit.results?.flashcards)
  ) {
    return;
  }

  assertRegenerationBaseline(kit);

  const questions = kit.results?.questions || [];
  const requirements = kit.results?.requirements?.items || [];
  const existingFlashcards = kit.results?.flashcards || [];

  const knownRequirementIds = new Set(requirements.map((r) => r.id));

  const userPrompt = buildFlashcardsPrompt(questions, requirements);

  const llm = getLLMClient();
  const rawOutput = await llm.completeJSON(SYSTEM_PROMPT, userPrompt, {
    temperature: 0.3,
    maxTokens: 4096,
  });

  const validated = validateFlashcardsOutput(rawOutput, knownRequirementIds);

  let flashcards;

  if (isFlashcardRegen || isQuestionRegen) {
    const generated = validated.map((card) => ({
      front: card.front,
      back: card.back,
      requirement_ids: card.requirement_ids,
    }));
    flashcards = mergeFlashcards(existingFlashcards, generated);
  } else {
    flashcards = validated.map((card, idx) =>
      withGeneratedState({
        id: `f${idx + 1}`,
        front: card.front,
        back: card.back,
        requirement_ids: card.requirement_ids,
      })
    );
  }

  await reloadKitForConcurrencyCheck(kitId);

  await Kit.findByIdAndUpdate(kitId, {
    'results.flashcards': flashcards,
  });

  if (isFlashcardRegen) {
    return { next: terminalNextForRegeneration(kit) };
  }
}

module.exports = generateFlashcards;
