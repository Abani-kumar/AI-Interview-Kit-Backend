// Generic bounded HTTP fetch with MANUAL redirect handling.
//
// FIX: automatic redirect following (`redirect: 'follow'`) is a well-known
// SSRF bypass — a public URL can 301/302 to 127.0.0.1 or a private IP, and
// the original URL validation never sees the real destination. Also, robots.txt
// was only ever checked against the ORIGINAL origin — a redirect to a
// different origin bypassed that origin's robots policy entirely.
//
// Fix: redirect: 'manual'. Each redirect hop is re-validated through
// urlValidator AND re-checked against that origin's robots.txt by the
// caller (crawler.js), with a hard cap on hop count.

const { validateAndNormalizeUrl } = require('./urlValidator');

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_BYTES = 2_000_000;
const MAX_REDIRECTS = 3;

// onRedirectHop(url) is called for every redirect target BEFORE it is
// followed, so the caller can re-check robots.txt for the new origin.
// It should throw to abort following the redirect.
async function httpFetch(url, options = {}) {
  const {
    timeoutMs = DEFAULT_TIMEOUT_MS,
    maxBytes = DEFAULT_MAX_BYTES,
    acceptContentTypes = ['text/html', 'text/plain'],
    onRedirectHop = null,
  } = options;

  let currentUrl = url;
  let redirectCount = 0;

  while (true) {
    // Re-validate SSRF rules on every hop, not just the first URL
    await validateAndNormalizeUrl(currentUrl);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    let res;
    try {
      res = await fetch(currentUrl, {
        signal: controller.signal,
        redirect: 'manual', // we handle redirects ourselves
        headers: {
          'User-Agent': 'InterviewPrepKitBot/1.0 (+research stage; respects robots.txt)',
        },
      });
    } finally {
      clearTimeout(timeout);
    }

    const isRedirect = [301, 302, 303, 307, 308].includes(res.status);

    if (isRedirect) {
      redirectCount++;
      if (redirectCount > MAX_REDIRECTS) {
        throw new Error(`Too many redirects (>${MAX_REDIRECTS}) fetching ${url}`);
      }

      const location = res.headers.get('location');
      if (!location) {
        throw new Error(`Redirect response missing Location header for ${currentUrl}`);
      }

      const nextUrl = new URL(location, currentUrl).toString();

      // Let the caller re-check robots.txt for the new origin before we follow it
      if (onRedirectHop) {
        await onRedirectHop(nextUrl);
      }

      currentUrl = nextUrl;
      continue; // loop: validate + fetch the new URL
    }

    // Not a redirect — process as final response
    const contentType = (res.headers.get('content-type') || '').split(';')[0].trim();
    const isAccepted = acceptContentTypes.some((t) => contentType.startsWith(t));

    if (!isAccepted) {
      return { status: res.status, body: '', contentType, finalUrl: currentUrl, skipped: true, reason: 'unsupported_content_type' };
    }

    const contentLength = parseInt(res.headers.get('content-length') || '0', 10);
    if (contentLength > maxBytes) {
      return { status: res.status, body: '', contentType, finalUrl: currentUrl, skipped: true, reason: 'response_too_large' };
    }

    const reader = res.body?.getReader?.();
    let body = '';
    if (reader) {
      let received = 0;
      let tooLarge = false;
      const decoder = new TextDecoder();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          received += value.length;
          if (received > maxBytes) {
            // FIX A: explicitly cancel the reader so the underlying TCP
            // connection is released rather than held open until GC.
            // Without this, breaking out of the loop leaves the reader
            // locked and the connection leaks until the stream is GC'd.
            tooLarge = true;
            await reader.cancel();
            break;
          }
          body += decoder.decode(value, { stream: true });
        }
      } catch (readErr) {
        // reader.cancel() itself can throw if the stream is already closed —
        // safe to ignore, the important thing is we stopped reading.
        await reader.cancel().catch(() => {});
        throw readErr;
      }
      if (tooLarge) {
        return { status: res.status, body: '', contentType, finalUrl: currentUrl, skipped: true, reason: 'response_too_large' };
      }
    } else {
      body = await res.text();
    }

    return { status: res.status, body, contentType, finalUrl: currentUrl, skipped: false };
  }
}

module.exports = { httpFetch, MAX_REDIRECTS };
