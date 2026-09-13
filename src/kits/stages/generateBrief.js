// Stage handler — orchestrates brief generation.
// No network I/O. One LLM call. Persists companyBrief + keyEvidence,
// then enqueues generate-questions only after successful persistence.

const Kit = require('../../models/Kit');
const { getLLMClient } = require('../../llm/LLMClient');
const { withGeneratedState, isReplaceable } = require('../contentState');
const {
  isRegenerationSection,
  assertRegenerationBaseline,
  terminalNextForRegeneration,
  reloadKitForConcurrencyCheck,
} = require('../regenerationContext');
const { SYSTEM_PROMPT, buildBriefPrompt, buildKeyEvidence } = require('./generateBrief/briefPromptBuilder');
const { validateBriefOutput } = require('./generateBrief/briefSchemaValidator');
const { buildSources } = require('./generateBrief/sourceBuilder');

async function generateBrief(kitId) {
  const kit = await Kit.findById(kitId).lean();
  const isBriefRegen = isRegenerationSection(kit, 'brief');

  // Idempotency: skip only for initial pipeline runs, not explicit regeneration.
  if (
    !isBriefRegen &&
    kit.stages?.['generate-brief']?.status === 'done' &&
    kit.results?.companyBrief
  ) {
    return;
  }

  assertRegenerationBaseline(kit);

  const existingBrief = kit.results?.companyBrief || null;
  if (isBriefRegen && existingBrief && !isReplaceable(existingBrief)) {
    return { next: terminalNextForRegeneration(kit) };
  }

  const { companyData, discussionData, requirements } = kit.results || {};

  const userPrompt = buildBriefPrompt(companyData, discussionData, requirements);

  const llm = getLLMClient();
  const rawOutput = await llm.completeJSON(SYSTEM_PROMPT, userPrompt, {
    temperature: 0.2,
    maxTokens: 1024,
  });

  const validated = validateBriefOutput(rawOutput);
  const sources = buildSources(companyData, discussionData);

  const companyBrief = withGeneratedState({
    summary: validated.summary,
    what_they_do: validated.what_they_do,
    sources,
    interview_relevance: validated.interview_relevance,
    hiring_signals: validated.hiring_signals,
    interview_signals: validated.interview_signals,
  });

  const keyEvidence = buildKeyEvidence(companyData, discussionData);

  await reloadKitForConcurrencyCheck(kitId);

  await Kit.findByIdAndUpdate(kitId, {
    'results.companyBrief': companyBrief,
    'results.keyEvidence': keyEvidence,
  });

  if (isBriefRegen) {
    return { next: terminalNextForRegeneration(kit) };
  }
}

module.exports = generateBrief;
