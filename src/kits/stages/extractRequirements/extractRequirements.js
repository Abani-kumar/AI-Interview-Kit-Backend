// Stage handler — orchestrates the extraction pipeline.
// Reads from Kit.input.jd, writes to Kit.results.requirements.
// Ephemeral intermediates (raw LLM response, chunk merge) live only in
// process memory — they are either retried wholesale on failure or discarded on success.

const Kit = require('../../../models/Kit');
const { getLLMClient } = require('../../../llm/LLMClient');
const { SYSTEM_PROMPT, buildExtractionPrompt } = require('./promptBuilder');
const { validateRequirementsOutput } = require('./requirements.schema');
const { normalizeRequirementsOutput } = require('./normalize');
const { isOversized, extractFromChunks } = require('./chunkExtract');

async function extractRequirements(kitId) {
  const kit = await Kit.findById(kitId).lean();

  // Idempotency guard — if a prior successful run already persisted results,
  // skip the LLM call entirely. Safe to re-enter on BullMQ retry.
  if (kit.stages?.['extract-requirements']?.status === 'done' && kit.results?.requirements) {
    return;
  }

  const jdText = kit.input.jd;

  if (!jdText || typeof jdText !== 'string' || jdText.trim().length === 0) {
    throw new Error('Kit has no JD text — cannot extract requirements');
  }

  // --- LLM Extraction ---
  // Ephemeral: rawOutput lives in memory only. Not cached in Redis or Mongo.
  // If extraction fails here, BullMQ retries the full stage — cheap enough.
  let rawOutput;

  if (isOversized(jdText)) {
    // Chunking fallback — paragraph-boundary split, per-chunk extract, exact-match merge
    rawOutput = await extractFromChunks(jdText);
  } else {
    const llm = getLLMClient();
    const userPrompt = buildExtractionPrompt(jdText);
    rawOutput = await llm.completeJSON(SYSTEM_PROMPT, userPrompt, {
      temperature: 0.1, // low temp for consistent structured output
      maxTokens: 4096,
    });
  }

  // --- Structural Validation ---
  // Any structural/enum violation throws here → stage fails → BullMQ retries.
  // qualityWarnings are non-fatal — they travel with the results for downstream use.
  const { qualityWarnings } = validateRequirementsOutput(rawOutput);

  if (qualityWarnings.length > 0) {
    console.warn(
      `[extract-requirements] kit=${kitId} ${qualityWarnings.length} quality warning(s):`,
      qualityWarnings.map((w) => w.text)
    );
  }

  // --- Deterministic Normalization + ID Assignment ---
  const normalized = normalizeRequirementsOutput(rawOutput);

  // Attach quality warnings to the persisted result so the
  // question-generation stage can read them and adjust its system prompt.
  const requirementsResult = {
    ...normalized,
    qualityWarnings, // [] if none — always present, always an array
  };

  // --- Persist to MongoDB ---
  // This is the only write. No intermediate state is persisted.
  // On next retry (if marking stage done fails), the idempotency guard
  // at the top of this function will re-detect results and skip re-extraction.
  await Kit.findByIdAndUpdate(kitId, {
    'results.requirements': requirementsResult,
  });
}

module.exports = extractRequirements;
