// Stage handler.
// Supports initial generation, coverage gap-fill passes, and explicit regeneration.

const Kit = require('../../models/Kit');
const { getLLMClient } = require('../../llm/LLMClient');
const { withGeneratedState } = require('../contentState');
const {
  isRegenerationSection,
  assertRegenerationBaseline,
  reloadKitForConcurrencyCheck,
} = require('../regenerationContext');
const { mergeQuestions, appendGeneratedQuestions } = require('../regenerationMerge');
const { SYSTEM_PROMPT, buildQuestionsPrompt } = require('./generateQuestions/questionPromptBuilder');
const { validateQuestionsOutput } = require('./generateQuestions/questionSchemaValidator');

function toGeneratedQuestion(q, id) {
  return withGeneratedState({
    id,
    prompt: q.prompt,
    answer_outline: q.answer_outline,
    category: q.category,
    difficulty: q.difficulty,
    requirement_ids: q.requirement_ids,
  });
}

function toGeneratedPayload(q) {
  return {
    prompt: q.prompt,
    answer_outline: q.answer_outline,
    category: q.category,
    difficulty: q.difficulty,
    requirement_ids: q.requirement_ids,
  };
}

async function generateQuestions(kitId) {
  const kit = await Kit.findById(kitId).lean();

  const coveragePass = kit.results?.coveragePass ?? 0;
  const isGapFillPass = coveragePass > 0;
  const isQuestionRegen = isRegenerationSection(kit, 'questions');
  const missingRequirementIds = kit.results?.regeneration?.missingRequirementIds;
  const isFocusedRegen =
    isQuestionRegen &&
    Array.isArray(missingRequirementIds) &&
    missingRequirementIds.length > 0;

  if (
    !isGapFillPass &&
    !isQuestionRegen &&
    kit.stages?.['generate-questions']?.status === 'done' &&
    Array.isArray(kit.results?.questions) &&
    kit.results.questions.length > 0
  ) {
    return;
  }

  assertRegenerationBaseline(kit);

  const allRequirements = kit.results?.requirements?.items || [];
  const companyBrief = kit.results?.companyBrief || null;
  const qualityWarnings = kit.results?.requirements?.qualityWarnings || [];
  const roleTitle = kit.results?.requirements?.roleTitle || '';
  const seniority = kit.results?.requirements?.seniority || '';
  const existingQuestions = kit.results?.questions || [];

  const knownRequirementIds = new Set(allRequirements.map((r) => r.id));

  let targetRequirements;
  let isGapFillPassForPrompt = isGapFillPass;

  if (isFocusedRegen) {
    const missingSet = new Set(missingRequirementIds);
    targetRequirements = allRequirements.filter((r) => missingSet.has(r.id));
    isGapFillPassForPrompt = true;

    if (targetRequirements.length === 0) {
      console.warn(
        `[generate-questions] kit=${kitId} focused regeneration has no valid target requirements — skipping`
      );
      return;
    }
  } else if (isGapFillPass) {
    const uncoveredIds = new Set(kit.results?.coverage?.uncovered_requirement_ids || []);
    targetRequirements = allRequirements.filter((r) => uncoveredIds.has(r.id));

    if (targetRequirements.length === 0) {
      console.warn(
        `[generate-questions] kit=${kitId} gap-fill pass triggered but no uncovered requirements found — skipping`
      );
      return;
    }
  } else {
    targetRequirements = allRequirements;
  }

  const userPrompt = buildQuestionsPrompt({
    targetRequirements,
    allRequirements,
    companyBrief,
    roleTitle,
    seniority,
    qualityWarnings,
    isGapFillPass: isGapFillPassForPrompt,
  });

  const llm = getLLMClient();
  const rawOutput = await llm.completeJSON(SYSTEM_PROMPT, userPrompt, {
    temperature: 0.4,
    maxTokens: 4096,
  });

  const validatedQuestions = validateQuestionsOutput(rawOutput, knownRequirementIds);

  let allQuestions;

  if (isFocusedRegen || (isQuestionRegen && isGapFillPass)) {
    const generated = validatedQuestions.map(toGeneratedPayload);
    allQuestions = appendGeneratedQuestions(existingQuestions, generated);
  } else if (isQuestionRegen) {
    const generated = validatedQuestions.map(toGeneratedPayload);
    allQuestions = mergeQuestions(existingQuestions, generated);
  } else if (isGapFillPass) {
    const startIndex = existingQuestions.length;
    const questionsWithIds = validatedQuestions.map((q, idx) =>
      toGeneratedQuestion(q, `q${startIndex + idx + 1}`)
    );
    allQuestions = [...existingQuestions, ...questionsWithIds];
  } else {
    const questionsWithIds = validatedQuestions.map((q, idx) => toGeneratedQuestion(q, `q${idx + 1}`));
    allQuestions = questionsWithIds;
  }

  await reloadKitForConcurrencyCheck(kitId);

  await Kit.findByIdAndUpdate(kitId, {
    'results.questions': allQuestions,
  });
}

module.exports = generateQuestions;
