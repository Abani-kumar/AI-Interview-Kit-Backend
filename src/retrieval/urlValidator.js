// Validates and normalizes a URL before any network call.
// SSRF protection is ON by default. Only disabled via an explicit opt-in
// env flag, never inferred from NODE_ENV.
//
// FIX: the previous version had a broken conditional —
//   hostname === 'localhost' || net.isIP(hostname) === 0 ? false : isPrivateIp(hostname)
// — due to operator precedence, this evaluated in an unintended way and
// could silently skip the private-IP check. Rewritten as explicit,
// unambiguous statements below.

const dns = require('dns').promises;

const ALLOW_LOCAL_FETCH_TARGETS = process.env.ALLOW_LOCAL_FETCH_TARGETS === 'true';

const PRIVATE_IP_RANGES = [
  /^10\./,
  /^172\.(1[6-9]|2[0-9]|3[0-1])\./,
  /^192\.168\./,
  /^127\./,
  /^169\.254\./, // link-local
  /^0\./,
  /^::1$/,
  /^fc00:/i,
  /^fe80:/i,
];

function isPrivateIp(ip) {
  return PRIVATE_IP_RANGES.some((re) => re.test(ip));
}

// Validates a hostname/IP against the private-IP and localhost blocklist.
// Throws if disallowed. Used both for the initial URL and every redirect hop.
async function assertHostnameAllowed(hostname) {
  if (ALLOW_LOCAL_FETCH_TARGETS) return; // explicit batch/local-test opt-in

  const lowerHost = hostname.toLowerCase();

  if (lowerHost === 'localhost') {
    throw new Error('Refusing to fetch localhost — set ALLOW_LOCAL_FETCH_TARGETS=true for batch/local testing');
  }

  // If the hostname is already a literal IP, check it directly
  if (isPrivateIp(lowerHost)) {
    throw new Error(`Refusing to fetch private/loopback address: ${lowerHost}`);
  }

  // Otherwise resolve DNS and check the resolved IP — protects against
  // DNS rebinding to a private address behind a public-looking hostname.
  let resolvedAddress;
  try {
    const { address } = await dns.lookup(lowerHost);
    resolvedAddress = address;
  } catch {
    throw new Error(`Could not resolve hostname: ${lowerHost}`);
  }

  if (isPrivateIp(resolvedAddress)) {
    throw new Error(`Hostname ${lowerHost} resolves to a private address (${resolvedAddress})`);
  }
}

// Throws on any invalid/disallowed URL. Returns a normalized URL string on success.
async function validateAndNormalizeUrl(rawUrl) {
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error(`Invalid URL: ${rawUrl}`);
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error(`Unsupported protocol: ${parsed.protocol}`);
  }

  await assertHostnameAllowed(parsed.hostname);

  parsed.hash = ''; // fragments are never meaningful for server-side fetch
  return parsed.toString();
}

module.exports = { validateAndNormalizeUrl, assertHostnameAllowed, isPrivateIp, ALLOW_LOCAL_FETCH_TARGETS };
