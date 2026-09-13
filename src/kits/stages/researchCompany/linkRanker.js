const { getLLMClient } = require('../../../llm/LLMClient');
const { SYSTEM_PROMPT, buildLinkRankerPrompt } = require('./linkRankerPrompt');

const FETCH_TOP_N = parseInt(process.env.LINK_FETCH_TOP_N || '5', 10);

async function rankLinks(candidateLinks) {
  if (candidateLinks.length === 0) return [];

  try {
    const llm = getLLMClient();
    const userPrompt = buildLinkRankerPrompt(candidateLinks);
    const result = await llm.completeJSON(SYSTEM_PROMPT, userPrompt, {
      temperature: 0.1,
      maxTokens: 1024,
    });

    if (!Array.isArray(result.rankedUrls)) {
      throw new Error('rankedUrls missing or not an array');
    }

    const candidateUrlSet = new Set(candidateLinks.map((l) => l.url));
    const validRanked = result.rankedUrls.filter((url) => candidateUrlSet.has(url));

    if (validRanked.length === 0) {
      throw new Error('LLM ranking produced no valid URLs from the candidate set');
    }

    return validRanked.slice(0, FETCH_TOP_N);
  } catch (err) {
    console.warn(`[linkRanker] AI ranking failed, using deterministic order: ${err.message}`);
    return candidateLinks.slice(0, FETCH_TOP_N).map((l) => l.url);
  }
}

module.exports = { rankLinks, FETCH_TOP_N };
