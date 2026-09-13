// Builds the sources[] array deterministically from companyData and
// discussionData. Never trusts the LLM to supply URLs — it cannot
// invent sources, and it cannot accidentally drop or rewrite ones we know.
//
// Process: collect → validate → canonicalize → deduplicate.

const { canonicalizeUrl } = require('../../../retrieval/urlCanonicalizer');

// Only HTTP/HTTPS URLs are valid sources. Filter anything else out silently
// rather than throwing — an invalid URL in research results is not a reason
// to fail the brief stage.
function isValidHttpUrl(url) {
  try {
    const parsed = new URL(url);
    return ['http:', 'https:'].includes(parsed.protocol);
  } catch {
    return false;
  }
}

function buildSources(companyData, discussionData) {
  const rawUrls = [
    ...(companyData?.pages?.map((p) => p.url) || []),
    ...(discussionData?.results?.map((r) => r.url) || []),
  ];

  const validUrls = rawUrls.filter(isValidHttpUrl);

  // Canonicalize before deduplication so equivalent URLs collapse correctly
  const seen = new Set();
  const deduped = [];

  for (const url of validUrls) {
    const canonical = canonicalizeUrl(url);
    if (canonical && !seen.has(canonical)) {
      seen.add(canonical);
      deduped.push(canonical);
    }
  }

  return deduped;
}

module.exports = { buildSources };
