function canonicalizeUrl(rawUrl) {
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return null;
  }

  parsed.hash = '';
  parsed.hostname = parsed.hostname.toLowerCase();

  if (
    (parsed.protocol === 'http:' && parsed.port === '80') ||
    (parsed.protocol === 'https:' && parsed.port === '443')
  ) {
    parsed.port = '';
  }

  let pathname = parsed.pathname;
  if (pathname.length > 1 && pathname.endsWith('/')) {
    pathname = pathname.slice(0, -1);
  }
  parsed.pathname = pathname;

  return parsed.toString();
}

function dedupeUrls(links) {
  const seen = new Map();
  for (const link of links) {
    const canonical = canonicalizeUrl(link.url);
    if (!canonical) continue;
    if (!seen.has(canonical)) {
      seen.set(canonical, { ...link, url: canonical });
    }
  }
  return Array.from(seen.values());
}

module.exports = { canonicalizeUrl, dedupeUrls };
