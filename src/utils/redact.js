/**
 * redact.js — make a raw upstream payload safe to hand to another human.
 *
 * `GET /api/report` bundles verbatim upstream responses (Zernio account
 * documents, Graph nodes, Google token endpoints) because that is the only way
 * to tell "Pinterest is 0 upstream" from "we dropped Pinterest's numbers".
 * Those bodies contain access tokens, refresh tokens and API keys, and the whole
 * point of the report is that the user pastes or uploads it. So nothing leaves
 * this module without passing through `redactDeep`.
 *
 * Rules:
 *   1. a key that names a credential is replaced, whatever its value
 *   2. any long opaque string (40+ chars of token alphabet) is replaced, even
 *      under an innocent key — upstreams embed tokens in odd places
 *   3. arrays are capped, and every cap is reported so a truncated list is
 *      never mistaken for a complete one
 *   4. it never throws: a circular or exotic value degrades to a placeholder
 */

/**
 * Key names that hold a credential. Two tiers, because one broad pattern was
 * wrong in both directions:
 *
 *   STRONG  the key can only be a credential (`access_token`, `clientSecret`,
 *           `byokCredentials`). The whole subtree is masked, whatever its shape.
 *   WEAK    the key merely mentions one (`token`, `secret`, `key`). A string or
 *           number under it is masked, but an OBJECT is walked instead — because
 *           `/api/report` records upstream calls under labels like
 *           "page token exchange", and masking that object destroyed the
 *           evidence the report exists to carry.
 */
const STRONG_SECRET_KEY =
  /(access[_-]?token|refresh[_-]?token|id[_-]?token|api[_-]?key|apikey|client[_-]?secret|secret[_-]?key|private[_-]?key|password|passwd|passcode|bearer|authorization|auth[_-]?header|credential|mnemonic|seed[_-]?phrase|session[_-]?id)/i;
const SECRET_KEY =
  /(token|secret|password|passwd|passcode|credential|authorization|auth[_-]?header|api[_-]?key|apikey|access[_-]?key|private[_-]?key|cookie|session[_-]?id|bearer|signature|mnemonic|seed[_-]?phrase)/i;

/** An ISO timestamp is a fact about a credential, not the credential. */
const ISO_DATE = /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2})?/;

/** Values that look like a key even when the key name does not. */
const TOKEN_LIKE = /^[A-Za-z0-9_\-+=/.]{40,}$/;

/**
 * Keys of a credential *descriptor* — `{ set, length, preview }`. It states
 * whether a variable exists and how long it is; it holds no secret. Masking it
 * (as a secret-named key would normally be) destroys the one fact the report
 * needs: "is ACCESS_TOKEN set on this deployment at all?"
 */
const DESCRIPTOR_KEYS = new Set(['set', 'length', 'preview', 'present', 'masked', 'source', 'from']);

/** Keys whose value is a URL — kept, but with any query-string token removed. */
const URL_KEY = /(url|uri|link|permalink|endpoint|href|next|previous)/i;

function mask(value) {
  const s = typeof value === 'string' ? value : JSON.stringify(value);
  const len = s ? s.length : 0;
  // Two characters of prefix is enough to recognise a token family
  // ("EAAG…" is a Meta token, "ya29…" is Google) without leaking the value.
  const head = s ? `${s.slice(0, 2)}…` : '';
  return `[redacted ${len} chars ${head}]`;
}

/** Strip credentials from a URL's query string, keep the rest readable. */
function cleanUrl(value) {
  const s = String(value);
  return s.replace(/([?&](?:access_token|token|key|api_key|apikey|sig|signature|auth)=)[^&]*/gi, '$1[redacted]');
}

/**
 * @param {*} value           anything JSON-shaped
 * @param {object} opts       { maxItems = 25, maxDepth = 14, maxString = 4000 }
 * @returns {{ data: *, truncations: string[] }}
 */
function redactDeep(value, opts = {}) {
  const maxItems = Number.isFinite(opts.maxItems) ? opts.maxItems : 25;
  const maxDepth = Number.isFinite(opts.maxDepth) ? opts.maxDepth : 14;
  const maxString = Number.isFinite(opts.maxString) ? opts.maxString : 4000;
  const truncations = [];
  // Ancestors only, not "every object ever seen". A global visited-set reported
  // `[circular]` for a perfectly ordinary shared reference — /api/report keeps
  // the same Zernio account document under `raw.zernio.calls['GET /v1/accounts']`
  // and again under `account:pinterest.doc`, and the second copy vanished.
  const stack = [];

  const walk = (v, path, depth) => {
    if (v === null || v === undefined) return v;
    const t = typeof v;
    if (t === 'number' || t === 'boolean') return v;
    if (t === 'string') {
      if (TOKEN_LIKE.test(v)) return mask(v);
      if (URL_KEY.test(path.split('.').pop() || '')) return cleanUrl(v);
      if (v.length > maxString) {
        truncations.push(`${path}: string shortened from ${v.length} to ${maxString} chars`);
        return `${v.slice(0, maxString)}…[truncated]`;
      }
      return v;
    }
    if (t !== 'object') return String(v);
    if (stack.indexOf(v) !== -1) return '[circular]';
    if (depth > maxDepth) {
      truncations.push(`${path}: deeper than ${maxDepth} levels, cut`);
      return '[depth limit]';
    }
    stack.push(v);

    try {
      if (Array.isArray(v)) {
        if (v.length > maxItems) {
          truncations.push(`${path}: ${v.length} items → first ${maxItems} shown`);
          return v.slice(0, maxItems).map((x, i) => walk(x, `${path}[${i}]`, depth + 1));
        }
        return v.map((x, i) => walk(x, `${path}[${i}]`, depth + 1));
      }
      return walkObject(v, path, depth);
    } finally {
      stack.pop();
    }
  };

  const walkObject = (v, path, depth) => {
    const out = {};
    for (const [k, child] of Object.entries(v)) {
      const keyPath = `${path}.${k}`;
      if (SECRET_KEY.test(k)) {
        if (child === null || child === undefined) {
          out[k] = child;
          continue;
        }
        // "tokenExpiresAt": "2026-11-17T…" is exactly the kind of fact a
        // diagnostic report needs, and it is not a secret.
        if (typeof child === 'string' && ISO_DATE.test(child) && !STRONG_SECRET_KEY.test(k)) {
          out[k] = child;
          continue;
        }
        if (!STRONG_SECRET_KEY.test(k) && (Array.isArray(child) || typeof child === 'object')) {
          try {
            out[k] = walk(child, keyPath, depth + 1);
          } catch (e) {
            out[k] = `[unserialisable: ${e.message}]`;
          }
          continue;
        }
        if (typeof child === 'object' && !Array.isArray(child)) {
          const keys = Object.keys(child);
          if (keys.length && keys.every((x) => DESCRIPTOR_KEYS.has(x))) {
            out[k] = {
              ...child,
              ...(typeof child.preview === 'string'
                ? { preview: `${String(child.preview).replace(/…+$/, '').slice(0, 3)}…` }
                : {}),
            };
            continue;
          }
        }
        out[k] = mask(child);
        continue;
      }
      try {
        out[k] = walk(child, keyPath, depth + 1);
      } catch (e) {
        out[k] = `[unserialisable: ${e.message}]`;
      }
    }
    return out;
  };

  let data;
  try {
    data = walk(value, '$', 0);
  } catch (e) {
    data = { redactionError: e.message };
  }
  return { data, truncations };
}

/** True when a config value must never be echoed, even masked. */
function isSecretKey(key) {
  return SECRET_KEY.test(String(key || ''));
}

module.exports = { redactDeep, mask, cleanUrl, isSecretKey, SECRET_KEY, STRONG_SECRET_KEY, TOKEN_LIKE, DESCRIPTOR_KEYS };
