// Detects whether a fetched page is a hiring/interview-process page.
// Confidence-based: combines URL path segments, title, and content signals.
// A single incidental keyword (e.g. "work", "job") is never sufficient.
//
// Called by the crawler after each page fetch — this module is the single
// place that decides isHiringPage. Stays deterministic (no extra LLM call).

const NEGATIVE_PATH_SEGMENTS = new Set([
  'search',
  'images',
  'image',
  'imghp',
  'ads',
  'ad',
  'maps',
  'news',
  'shopping',
  'video',
  'videos',
  'accounts',
  'login',
  'signin',
  'signup',
]);

const STRONG_HIRING_PATH_SEGMENTS = new Set([
  'careers',
  'career',
  'jobs',
  'job',
  'hiring',
  'join-us',
  'join-our-team',
  'joinourteam',
  'work-with-us',
  'open-positions',
  'openings',
  'life-at',
  'opportunities',
  'vacancies',
  'employment',
  'recruiting',
  'recruitment',
]);

const STRONG_TITLE_PATTERNS = [
  /\bcareers\b/i,
  /\bjob openings?\b/i,
  /\bopen positions?\b/i,
  /\bjoin (?:us|our team)\b/i,
  /\bwe(?:'re| are) hiring\b/i,
  /\bwork with us\b/i,
  /\bcurrent openings?\b/i,
  /\blife at\b/i,
  /^jobs$/i,
  /^careers$/i,
];

const STRONG_CONTENT_PATTERNS = [
  /\binterview process\b/i,
  /\bhiring process\b/i,
  /\bhow we hire\b/i,
  /\btechnical interview\b/i,
  /\btake[- ]home (?:assignment|project|test)\b/i,
  /\bonsite interview\b/i,
  /\bphone screen\b/i,
  /\bapply (?:now|for this|online)\b/i,
  /\bopen positions?\b/i,
  /\bjoin our team\b/i,
  /\bjob application\b/i,
  /\bcareer opportunities\b/i,
  /\bview (?:all )?openings\b/i,
  /\bopen roles?\b/i,
];

const MODERATE_CONTENT_PATTERNS = [
  /\bwe(?:'re| are) hiring\b/i,
  /\bwork with us\b/i,
  /\bexplore careers\b/i,
  /\bsee open roles\b/i,
];

function getPathname(url) {
  try {
    return new URL(url).pathname.toLowerCase();
  } catch {
    return '';
  }
}

function getPathSegments(pathname) {
  return pathname.split('/').filter(Boolean);
}

function hasNegativePath(segments) {
  return segments.some((segment) => NEGATIVE_PATH_SEGMENTS.has(segment));
}

function hasStrongHiringPathSegment(segments) {
  return segments.some((segment) => STRONG_HIRING_PATH_SEGMENTS.has(segment));
}

function matchesAny(patterns, value) {
  const text = value || '';
  return patterns.some((pattern) => pattern.test(text));
}

/**
 * @param {{ url: string, title?: string, text?: string, wasAiRanked?: boolean }} page
 * @returns {boolean}
 */
function isHiringPage({ url, title, text, wasAiRanked = false }) {
  const pathname = getPathname(url);
  const segments = getPathSegments(pathname);
  const pageText = (text || '').slice(0, 2000);
  const pageTitle = title || '';

  if (hasNegativePath(segments)) {
    return false;
  }

  const strongPath = hasStrongHiringPathSegment(segments);
  const strongTitle = matchesAny(STRONG_TITLE_PATTERNS, pageTitle);
  const strongContent = matchesAny(STRONG_CONTENT_PATTERNS, pageText);
  const moderateContent = matchesAny(MODERATE_CONTENT_PATTERNS, pageText);

  // Strong career/jobs URL paths are definitive (e.g. /careers, /jobs/backend-engineer).
  if (strongPath) {
    return true;
  }

  // Title or body with explicit hiring/interview language.
  if (strongTitle || strongContent) {
    return true;
  }

  // AI-ranked pages still need at least one hiring signal — ranking alone is not enough.
  if (wasAiRanked && moderateContent) {
    return true;
  }

  return false;
}

module.exports = {
  isHiringPage,
  getPathSegments,
  hasNegativePath,
  hasStrongHiringPathSegment,
};
