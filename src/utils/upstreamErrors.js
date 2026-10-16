/**
 * upstreamErrors.js — tell "the internet hiccuped" apart from "your .env is
 * wrong".
 *
 * A connection failure used to fall through to the credential-shaped fallback
 * hints, so a sleeping host produced advice like "The channel must have at least
 * one public video" or "Check ACCESS_TOKEN scopes" — sending people off to fix
 * something that was never broken. Network failures now say what they are.
 */
const NETWORK_CODES = new Set([
  'ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'ETIMEDOUT', 'ECONNRESET', 'ECONNABORTED',
  'EHOSTUNREACH', 'ENETUNREACH', 'EPIPE', 'ERR_NETWORK', 'UPSTREAM_TIMEOUT',
]);

/** True when the request never produced an HTTP response from the upstream. */
function isNetworkError(e) {
  if (!e) return false;
  if (e.response) return false; // the upstream answered — that is an API error, not a network one
  const code = e.code || e.errno || '';
  if (NETWORK_CODES.has(code)) return true;
  const msg = String(e.message || '').toLowerCase();
  return (
    msg.includes('econnrefused') ||
    msg.includes('enotfound') ||
    msg.includes('getaddrinfo') ||
    msg.includes('socket hang up') ||
    msg.includes('network') ||
    msg.includes('timeout') ||
    msg.includes('did not answer within')
  );
}

/** One sentence, provider-specific, and deliberately not about credentials. */
function networkHint(provider = 'the upstream API') {
  return `Could not reach ${provider} — the host was unreachable or too slow to answer. This is not a credential problem; the dashboard keeps the last good numbers and retries on the next refresh.`;
}

/** Pick a hint: network first, then whatever the caller would have said. */
function hintFor(e, provider, fallback = null) {
  if (isNetworkError(e)) return networkHint(provider);
  return fallback;
}

module.exports = { isNetworkError, networkHint, hintFor, NETWORK_CODES };
