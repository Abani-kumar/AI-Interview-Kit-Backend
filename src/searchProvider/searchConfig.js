// Safe parsing for search-related env configuration.
// Brave Web Search requires count in [1, 20].

const DEFAULT_MAX_QUERIES = 3;
const DEFAULT_RESULTS_PER_QUERY = 3;
const MIN_RESULTS_PER_QUERY = 1;
const MAX_RESULTS_PER_QUERY = 20;

function parsePositiveInt(value, fallback) {
  const parsed = parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 1) {
    return fallback;
  }
  return parsed;
}

function getMaxSearchQueries() {
  return parsePositiveInt(process.env.MAX_SEARCH_QUERIES, DEFAULT_MAX_QUERIES);
}

function getResultsPerQuery() {
  const parsed = parsePositiveInt(process.env.SEARCH_RESULTS_PER_QUERY, DEFAULT_RESULTS_PER_QUERY);
  return Math.min(Math.max(parsed, MIN_RESULTS_PER_QUERY), MAX_RESULTS_PER_QUERY);
}

module.exports = {
  getMaxSearchQueries,
  getResultsPerQuery,
  MIN_RESULTS_PER_QUERY,
  MAX_RESULTS_PER_QUERY,
};
