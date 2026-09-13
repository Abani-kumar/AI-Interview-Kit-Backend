// Chunking fallback — only used when JD exceeds SAFE_JD_CHARS.
//
// V1 KNOWN LIMITATION: if any individual chunk produces a structurally
// malformed LLM response (missing keys, wrong enum, empty text), that
// chunk's extraction call throws and the entire stage fails. BullMQ then
// retries the whole stage from scratch. There is no per-chunk retry or
// partial-salvage logic. This is acceptable for V1 because:
//   - Real-world JDs almost never trigger chunking at all (see SAFE_JD_CHARS)
//   - The retry cost is low (one LLM call per chunk, not the whole pipeline)
//   - Adding per-chunk retry would add significant complexity for a rare path
//
// FIX #2: processing order is now:
//   chunk extraction → normalize each chunk's text → exact dedup → final validation → assign IDs
//
// Dedup runs on normalized text so "Node.js experience." and "Node.js experience"
// correctly deduplicate. Previously dedup ran on raw pre-normalization text.

const { getLLMClient } = require('../../../llm/LLMClient');
const { SYSTEM_PROMPT, buildExtractionPrompt } = require('./promptBuilder');
const { validateRequirementsOutput } = require('./requirements.schema');
const { normalizeText, deduplicateRequirements } = require('./normalize');

// FIX #3: default raised from 12,000 to 50,000 chars (~12,500 tokens).
// Real-world JDs are typically 3,000–10,000 chars. Even a dense 3-page JD
// sits around 8,000 chars. 50,000 ensures chunking only triggers on genuinely
// pathological inputs (scraped pages, concatenated postings, etc.) and never
// fires on any legitimate single job description.
// Override via SAFE_JD_CHARS env var if your chosen model has a tighter limit.
const SAFE_JD_CHARS = parseInt(process.env.SAFE_JD_CHARS || '50000', 10);
const MIN_CHUNK_CHARS = 800;

function isOversized(jdText) {
  return jdText.length > SAFE_JD_CHARS;
}

// Split on double-newlines (section/paragraph boundaries).
// Does not split mid-sentence. Hard-splits only if a single paragraph
// somehow exceeds SAFE_JD_CHARS (effectively impossible for real JDs).
function splitIntoChunks(jdText) {
  const paragraphs = jdText.split(/\n\s*\n/).filter((p) => p.trim().length > 0);
  const chunks = [];
  let current = '';

  for (const para of paragraphs) {
    if (current.length + para.length > SAFE_JD_CHARS && current.length >= MIN_CHUNK_CHARS) {
      chunks.push(current.trim());
      current = para;
    } else {
      current = current ? `${current}\n\n${para}` : para;
    }
  }

  if (current.trim()) chunks.push(current.trim());

  return chunks.flatMap((chunk) => {
    if (chunk.length <= SAFE_JD_CHARS) return [chunk];
    const parts = [];
    for (let i = 0; i < chunk.length; i += SAFE_JD_CHARS) {
      parts.push(chunk.slice(i, i + SAFE_JD_CHARS));
    }
    return parts;
  });
}

// FIX #2: normalize each chunk's requirement text before merging,
// so dedup operates on consistent text (trimmed, whitespace-collapsed,
// trailing period removed) rather than on raw LLM output.
function normalizeChunkResult(rawChunkResult) {
  return {
    roleTitle: normalizeText(rawChunkResult.roleTitle || ''),
    seniority: normalizeText(rawChunkResult.seniority || ''),
    responsibilities: (rawChunkResult.responsibilities || [])
      .map((r) => (typeof r === 'string' ? normalizeText(r) : ''))
      .filter(Boolean),
    requirements: (rawChunkResult.requirements || []).map((req) => ({
      text: normalizeText(req.text || ''),
      kind: req.kind,
      priority: req.priority,
    })),
  };
}

// Merge normalized chunk results, deduplicating on normalized text.
// First-seen value wins for roleTitle and seniority.
function mergeNormalizedChunks(normalizedChunks) {
  const reqsSeen = new Set();
  const respsSeen = new Set();
  const merged = {
    roleTitle: '',
    seniority: '',
    responsibilities: [],
    requirements: [],
  };

  for (const chunk of normalizedChunks) {
    if (chunk.roleTitle && !merged.roleTitle) merged.roleTitle = chunk.roleTitle;
    if (chunk.seniority && !merged.seniority) merged.seniority = chunk.seniority;

    for (const resp of chunk.responsibilities) {
      const key = resp.toLowerCase();
      if (!respsSeen.has(key)) {
        respsSeen.add(key);
        merged.responsibilities.push(resp);
      }
    }

    for (const req of chunk.requirements) {
      const key = req.text.toLowerCase();
      // Skip empty-text requirements — normalizer already stripped them,
      // but guard here in case a chunk had a structurally malformed req
      // that slipped past per-chunk validation (see V1 limitation above)
      if (key && !reqsSeen.has(key)) {
        reqsSeen.add(key);
        merged.requirements.push(req);
      }
    }
  }

  return merged;
}

// FIX #2: full updated flow with correct ordering
async function extractFromChunks(jdText) {
  const llm = getLLMClient();
  const chunks = splitIntoChunks(jdText);
  const normalizedChunks = [];

  for (let i = 0; i < chunks.length; i++) {
    const userPrompt = buildExtractionPrompt(chunks[i], { index: i, total: chunks.length });

    // Step 1: get raw output from LLM
    // V1 LIMITATION: structural malformation here fails the whole stage (see top comment)
    const rawChunkResult = await llm.completeJSON(SYSTEM_PROMPT, userPrompt, {
      temperature: 0.1,
      maxTokens: 4096,
    });

    // Step 2: validate structure of this chunk's output before normalizing
    // Throws on structural/enum errors — bubbles up as stage failure
    validateRequirementsOutput(rawChunkResult);

    // Step 3: normalize this chunk's text immediately, before merging
    normalizedChunks.push(normalizeChunkResult(rawChunkResult));
  }

  // Step 4: merge + exact-dedup on normalized text
  // Returns a normalized merged object — the stage handler runs final
  // validation + ID assignment on this, same as the single-call path
  return mergeNormalizedChunks(normalizedChunks);
}

module.exports = { isOversized, extractFromChunks, splitIntoChunks };
