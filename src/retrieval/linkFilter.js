// Deterministic junk filtering + relevance scoring.
//
// FIX: previously restricted to same-origin links only, which silently
// excluded external job-board links (Greenhouse, Lever, Ashby, etc.) —
// exactly the kind of hiring information this stage is supposed to find.
// Now: same-origin OR known ATS domain.
//
// FIX: hiring-signal keywords expanded — "join us", "working at",
// "our process", "life at" etc. are common section titles that the
// original narrow regex missed.

const JUNK_PATTERNS = [
  /\/(login|signin|signup|register)(\/|$)/i,
  /\/(privacy|terms|cookie)/i,
  /\/(cart|checkout|account)/i,
  /^mailto:/i,
  /^tel:/i,
  /(facebook|twitter|x\.com|instagram|linkedin|youtube|tiktok)\.com/i,
  /\.(png|jpg|jpeg|gif|svg|css|js|pdf|zip|ico)(\?|$)/i,
  /\/(wp-admin|wp-content|assets|static|cdn)\//i,
];

// Known Applicant Tracking System domains — hiring pages hosted here are
// exactly the content this stage needs, so they're allowed even though
// they're a different origin from the company homepage.
const ATS_ALLOWLIST = [
  'greenhouse.io',
  'lever.co',
  'ashbyhq.com',
  'workable.com',
  'breezy.hr',
  'smartrecruiters.com',
  'myworkdayjobs.com',
  'jobvite.com',
  'bamboohr.com',
];

const RELEVANCE_KEYWORDS = [
  { pattern: /career/i, weight: 10 },
  { pattern: /\bjob/i, weight: 10 },
  { pattern: /hiring/i, weight: 10 },
  { pattern: /interview/i, weight: 9 },
  { pattern: /engineering/i, weight: 6 },
  { pattern: /\babout\b/i, weight: 5 },
  { pattern: /\bteam\b/i, weight: 4 },
  { pattern: /handbook/i, weight: 8 },
  { pattern: /culture/i, weight: 5 },
  { pattern: /life\s*at/i, weight: 6 },
  { pattern: /join\s*us/i, weight: 8 },
  { pattern: /working\s*(at|here)/i, weight: 7 },
  { pattern: /our\s*process/i, weight: 7 },
  { pattern: /how\s*we\s*hire/i, weight: 9 },
];

const CANDIDATE_LIMIT = parseInt(process.env.LINK_CANDIDATE_LIMIT || '15', 10);

function isJunkLink(link) {
  return JUNK_PATTERNS.some((re) => re.test(link.url) || re.test(link.anchorText));
}

function isAtsDomain(url) {
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    return ATS_ALLOWLIST.some((domain) => hostname === domain || hostname.endsWith(`.${domain}`));
  } catch {
    return false;
  }
}

function scoreLink(link) {
  const haystack = `${link.url} ${link.anchorText} ${link.title}`;
  let score = 0;
  for (const { pattern, weight } of RELEVANCE_KEYWORDS) {
    if (pattern.test(haystack)) score += weight;
  }
  if (isAtsDomain(link.url)) score += 15; // ATS links are almost always the hiring page itself
  return score;
}

// Minimum keyword score an ATS-domain link must have to pass the origin filter.
// Prevents arbitrary external ATS links (e.g. a competitor's Greenhouse listing
// linked from a blog post) from being crawled just because the hostname is known.
// An ATS link with score 0 has no hiring-signal in its URL, anchor, or title —
// it is almost certainly not the company's own job board page.
const ATS_MIN_SCORE = 1;

function filterAndScoreLinks(links, homepageUrl) {
  const homepageOrigin = new URL(homepageUrl).origin;

  // FIX C: ATS-domain links are only allowed through if they also carry at
  // least one hiring-relevance keyword signal. A bare greenhouse.io link with
  // no relevant anchor text or URL path is excluded regardless of its domain.
  const allowedOrigin = links.filter((link) => {
    try {
      const linkOrigin = new URL(link.url).origin;
      if (linkOrigin === homepageOrigin) return true;
      if (isAtsDomain(link.url)) {
        // Compute a keyword-only score (exclude the ATS domain bonus itself)
        // to check whether this specific link has any actual hiring signal.
        const keywordScore = RELEVANCE_KEYWORDS.reduce((acc, { pattern, weight }) => {
          const haystack = `${link.url} ${link.anchorText} ${link.title}`;
          return acc + (pattern.test(haystack) ? weight : 0);
        }, 0);
        return keywordScore >= ATS_MIN_SCORE;
      }
      return false;
    } catch {
      return false;
    }
  });

  const clean = allowedOrigin.filter((link) => !isJunkLink(link));

  const scored = clean
    .map((link) => ({ ...link, score: scoreLink(link) }))
    .sort((a, b) => b.score - a.score);

  return scored.slice(0, CANDIDATE_LIMIT);
}

module.exports = { filterAndScoreLinks, isJunkLink, scoreLink, isAtsDomain, CANDIDATE_LIMIT, ATS_ALLOWLIST };
