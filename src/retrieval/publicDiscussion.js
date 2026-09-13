// Generates targeted search queries (AI-assisted, with fixed-template
// fallback), runs them through the search client, returns a compact result.
//
// FIX: this now runs AFTER crawlCompanySite (see researchCompany.js),
// so `context.companyName` and `context.hiringPageFound` are the REAL
// values discovered by the crawler — not a hostname guess.

const { getLLMClient } = require('../llm/LLMClient');
const { getSearchClient } = require('../searchProvider/SearchClient');
const { getMaxSearchQueries, getResultsPerQuery } = require('../searchProvider/searchConfig');
const { sanitizeSearchQueries } = require('../searchProvider/querySanitizer');
const { SYSTEM_PROMPT, buildSearchQueryPrompt } = require('../kits/stages/researchCompany/searchQueryPrompt');

function fixedTemplateQueries(companyName) {
  if (!companyName) return [];
  return [
    `${companyName} interview process`,
    `${companyName} interview questions`,
    `${companyName} technical interview experience`,
  ];
}

async function generateSearchQueries(context) {
  const maxQueries = getMaxSearchQueries();

  try {
    const llm = getLLMClient();
    const userPrompt = buildSearchQueryPrompt(context);
    const result = await llm.completeJSON(SYSTEM_PROMPT, userPrompt, {
      temperature: 0.3,
      maxTokens: 512,
    });

    if (!Array.isArray(result.queries) || result.queries.length === 0) {
      throw new Error('queries missing or empty');
    }

    // Do not slice here — empty/duplicate entries would consume slots before sanitization.
    return result.queries;
  } catch (err) {
    console.warn(`[publicDiscussion] Query generation failed, using fixed templates: ${err.message}`);
    return fixedTemplateQueries(context.companyName).slice(0, maxQueries);
  }
}

function skippedQueryErrors(skipped) {
  return skipped.map((entry) => ({
    query: entry.query,
    type: 'query_skipped',
    message: entry.reason,
  }));
}

function searchErrorFromException(query, err) {
  return {
    query,
    type: 'search_failed',
    status: err.status ?? null,
    code: err.code ?? null,
    message: err.message,
  };
}

async function searchPublicDiscussion(context) {
  const maxQueries = getMaxSearchQueries();
  const resultsPerQuery = getResultsPerQuery();
  const rawQueries = await generateSearchQueries(context);
  const { queries, skipped } = sanitizeSearchQueries(rawQueries, maxQueries);
  const errors = skippedQueryErrors(skipped);

  if (queries.length === 0) {
    return { results: [], errors, queriesUsed: [] };
  }

  const searchClient = getSearchClient();
  const allResults = [];

  for (const query of queries) {
    try {
      const { results } = await searchClient.search(query, { count: resultsPerQuery });
      allResults.push(...results.map((r) => ({ ...r, query })));
    } catch (err) {
      errors.push(searchErrorFromException(query, err));
    }
  }

  // Deduplicate results by URL across queries
  const seen = new Set();
  const dedupedResults = allResults.filter((r) => {
    if (!r.url || seen.has(r.url)) return false;
    seen.add(r.url);
    return true;
  });

  return { results: dedupedResults, errors, queriesUsed: queries };
}

module.exports = { searchPublicDiscussion, generateSearchQueries, fixedTemplateQueries };
