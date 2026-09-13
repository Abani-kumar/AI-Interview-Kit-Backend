// Uses the `robots-parser` npm package instead of a hand-rolled parser.
// Hand-rolled robots.txt parsing is notoriously error-prone (Allow rules,
// wildcard paths, precedence between Allow/Disallow, $ end-anchors) —
// not worth reimplementing for this assessment.
//
// POLICY DECISION — documented explicitly per review feedback:
// If robots.txt returns 404, standard convention is "no restrictions" (allow all).
// If robots.txt fetch fails for any OTHER reason (network error, timeout,
// 5xx), we FAIL CLOSED for that origin: treat it as "disallow all" rather
// than silently proceeding. This is the more conservative, spec-compliant
// choice — the assessment explicitly requires respecting robots.txt, and
// a transient fetch failure should not be treated as implicit permission.
// The trade-off: a flaky robots.txt endpoint may cause us to skip an
// otherwise-crawlable site. Documented as a deliberate choice, not a bug.

const robotsParser = require('robots-parser');
const { httpFetch } = require('./httpFetcher');

const ROBOTS_FETCH_TIMEOUT_MS = 5000;
const USER_AGENT = 'InterviewPrepKitBot';

// Returns a robots-parser instance for the given origin, or a sentinel
// indicating "fail closed" if the fetch failed for a non-404 reason.
async function fetchRobotsRules(origin) {
  const robotsUrl = `${origin}/robots.txt`;

  let result;
  try {
    result = await httpFetch(robotsUrl, {
      timeoutMs: ROBOTS_FETCH_TIMEOUT_MS,
      maxBytes: 100_000,
      acceptContentTypes: ['text/plain'],
    });
  } catch (err) {
    // Network error / timeout — fail closed per policy above
    return { disallowAll: true, parser: null };
  }

  if (result.status === 404) {
    // No robots.txt at all — standard convention is "everything allowed"
    return { disallowAll: false, parser: robotsParser(robotsUrl, '') };
  }

  if (result.skipped || result.status >= 400) {
    // robots.txt exists but couldn't be read properly — fail closed
    return { disallowAll: true, parser: null };
  }

  const parser = robotsParser(robotsUrl, result.body);
  return { disallowAll: false, parser };
}

function isPathAllowed(fullUrl, robotsRules) {
  if (robotsRules.disallowAll) return false;
  if (!robotsRules.parser) return true; // defensive default, shouldn't hit this branch
  return robotsRules.parser.isAllowed(fullUrl, USER_AGENT) !== false;
}

module.exports = { fetchRobotsRules, isPathAllowed };
