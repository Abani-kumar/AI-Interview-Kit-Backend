// Orchestrates: validate URL → check robots.txt → fetch homepage →
// extract links → filter/score → AI rank → fetch top N pages →
// extract readable text → flag hiring-relevant pages.
//
// FIX: robots.txt is now checked per-hop via onRedirectHop, so a redirect
// to a different origin can't bypass that origin's robots policy.
// FIX: hiring-page detection now uses hiringPageDetector (3-signal check)
// instead of a single narrow regex.

const { validateAndNormalizeUrl } = require('./urlValidator');
const { fetchRobotsRules, isPathAllowed } = require('./robotsChecker');
const { httpFetch } = require('./httpFetcher');
const { extractLinks, extractReadableText } = require('./htmlParser');
const { dedupeUrls } = require('./urlCanonicalizer');
const { filterAndScoreLinks } = require('./linkFilter');
const { isHiringPage } = require('./hiringPageDetector');
const { rankLinks } = require('../kits/stages/researchCompany/linkRanker');

// Cache of robots rules per origin for this single crawl run — avoids
// re-fetching robots.txt for every redirect hop landing on the same origin.
function createRobotsCache() {
  const cache = new Map();
  return async function getRobotsForOrigin(origin) {
    if (!cache.has(origin)) {
      cache.set(origin, await fetchRobotsRules(origin));
    }
    return cache.get(origin);
  };
}

async function crawlCompanySite(companyUrl) {
  const errors = [];
  const pages = [];
  const getRobotsForOrigin = createRobotsCache();

  let normalizedUrl;
  try {
    normalizedUrl = await validateAndNormalizeUrl(companyUrl);
  } catch (err) {
    return emptyResult([{ url: companyUrl, type: 'invalid_url', message: err.message }]);
  }

  const homepageOrigin = new URL(normalizedUrl).origin;
  const homepageRobots = await getRobotsForOrigin(homepageOrigin);

  if (!isPathAllowed(normalizedUrl, homepageRobots)) {
    return emptyResult([{ url: normalizedUrl, type: 'robots_disallowed', message: 'robots.txt disallows this path' }]);
  }

  // onRedirectHop: re-validate SSRF (already done inside httpFetch per hop)
  // AND check robots.txt for the new origin before following.
  const onRedirectHop = async (nextUrl) => {
    const nextOrigin = new URL(nextUrl).origin;
    const nextRobots = await getRobotsForOrigin(nextOrigin);
    if (!isPathAllowed(nextUrl, nextRobots)) {
      throw new Error(`Redirect target disallowed by robots.txt: ${nextUrl}`);
    }
  };

  let homepageResult;
  try {
    homepageResult = await httpFetch(normalizedUrl, { timeoutMs: 10000, maxBytes: 2_000_000, onRedirectHop });
  } catch (err) {
    return emptyResult([{ url: normalizedUrl, type: 'homepage_unreachable', message: err.message }]);
  }

  if (homepageResult.skipped || homepageResult.status >= 400) {
    return emptyResult([{
      url: normalizedUrl,
      type: homepageResult.skipped ? homepageResult.reason : `http_${homepageResult.status}`,
      message: `Homepage fetch did not return usable content (status ${homepageResult.status})`,
    }]);
  }

  const { title: homeTitle, text: homeText } = extractReadableText(homepageResult.body);
  pages.push({
    url: homepageResult.finalUrl,
    title: homeTitle,
    text: homeText,
    isHiringPage: isHiringPage({ url: homepageResult.finalUrl, title: homeTitle, text: homeText, wasAiRanked: false }),
  });

  const rawLinks = extractLinks(homepageResult.body, homepageResult.finalUrl);
  const dedupedLinks = dedupeUrls(rawLinks);
  const candidates = filterAndScoreLinks(dedupedLinks, normalizedUrl);
  const topUrls = await rankLinks(candidates);

  for (const url of topUrls) {
    let urlOrigin;
    try {
      urlOrigin = new URL(url).origin;
    } catch {
      errors.push({ url, type: 'invalid_url', message: 'Malformed candidate URL' });
      continue;
    }

    const robots = await getRobotsForOrigin(urlOrigin);
    if (!isPathAllowed(url, robots)) {
      errors.push({ url, type: 'robots_disallowed', message: 'robots.txt disallows this path' });
      continue;
    }

    try {
      const result = await httpFetch(url, { timeoutMs: 10000, maxBytes: 2_000_000, onRedirectHop });

      if (result.skipped) {
        errors.push({ url, type: result.reason, message: `Skipped: ${result.reason}` });
        continue;
      }
      if (result.status >= 400) {
        errors.push({ url, type: `http_${result.status}`, message: `Page returned status ${result.status}` });
        continue;
      }

      const { title, text } = extractReadableText(result.body);
      const hiringFlag = isHiringPage({ url: result.finalUrl, title, text, wasAiRanked: true });

      pages.push({ url: result.finalUrl, title, text, isHiringPage: hiringFlag });
    } catch (err) {
      errors.push({ url, type: 'fetch_failed', message: err.message });
    }
  }

  return {
    name: homeTitle || '',
    pagesUsed: pages.map((p) => p.url),
    pages,
    hiringInfo: pages.some((p) => p.isHiringPage) ? { found: true } : { found: false },
    errors,
  };
}

function emptyResult(errors) {
  return { name: '', pagesUsed: [], pages: [], hiringInfo: null, errors };
}

module.exports = { crawlCompanySite };
