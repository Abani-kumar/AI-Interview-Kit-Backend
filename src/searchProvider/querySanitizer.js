// Prepares search queries before provider calls.
// Brave Web Search: q must be 1–400 chars and at most 50 words.

const MAX_QUERY_CHARS = 400;
const MAX_QUERY_WORDS = 50;

function normalizeQueryValue(value) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  if (typeof value !== 'string') {
    return '';
  }
  return value.trim().replace(/\s+/g, ' ');
}

function limitQueryLength(query) {
  const words = query.split(/\s+/).filter(Boolean);
  const trimmedWords = words.length > MAX_QUERY_WORDS ? words.slice(0, MAX_QUERY_WORDS) : words;
  let limited = trimmedWords.join(' ');
  if (limited.length > MAX_QUERY_CHARS) {
    limited = limited.slice(0, MAX_QUERY_CHARS).trim();
  }
  return limited;
}

function validateSearchQuery(query) {
  const normalized = normalizeQueryValue(query);
  if (!normalized) {
    return { valid: false, reason: 'empty query' };
  }
  const limited = limitQueryLength(normalized);
  if (!limited) {
    return { valid: false, reason: 'empty query after normalization' };
  }
  return { valid: true, query: limited };
}

/**
 * Trim, dedupe, discard invalid queries, and enforce the query-count limit.
 * @returns {{ queries: string[], skipped: Array<{ query: string, reason: string }> }}
 */
function sanitizeSearchQueries(rawQueries, maxQueries) {
  const limit = Number.isInteger(maxQueries) && maxQueries > 0 ? maxQueries : 3;
  const queries = [];
  const skipped = [];
  const seen = new Set();

  const source = Array.isArray(rawQueries) ? rawQueries : [];

  for (const raw of source) {
    const validation = validateSearchQuery(raw);
    if (!validation.valid) {
      skipped.push({
        query: typeof raw === 'string' ? raw : String(raw ?? ''),
        reason: validation.reason,
      });
      continue;
    }

    const key = validation.query.toLowerCase();
    if (seen.has(key)) {
      skipped.push({ query: validation.query, reason: 'duplicate query' });
      continue;
    }

    if (queries.length >= limit) {
      skipped.push({ query: validation.query, reason: 'query limit reached' });
      continue;
    }

    seen.add(key);
    queries.push(validation.query);
  }

  return { queries, skipped };
}

module.exports = {
  sanitizeSearchQueries,
  validateSearchQuery,
  normalizeQueryValue,
  limitQueryLength,
  MAX_QUERY_CHARS,
  MAX_QUERY_WORDS,
};
