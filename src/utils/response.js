const { diagnose } = require('./diagnosis');

function parseError(err) {
  const body = err.response?.data;
  let msg = '', code = '', details = null;
  if (body) {
    if (body.error?.message) { msg = body.error.message; code = String(body.error.code || body.error.type || ''); details = body.error.errors || body.error; }
    else if (typeof body === 'string') msg = body;
    else if (body.message) { msg = body.message; details = body; }
    else { msg = JSON.stringify(body).slice(0, 500); details = body; }
  }
  if (!msg) msg = err.message || 'Unknown error';
  if (!code) code = err.code || (err.response?.status ? 'HTTP_' + err.response.status : 'UNKNOWN');
  return { code, message: msg, details, httpStatus: err.response?.status || err.httpStatus || 500 };
}
function success({ platform, meta = {}, data, notice }) {
  const body = { success: true, platform, meta, data };
  if (notice) body.notice = notice;
  return body;
}
/**
 * platformEnvelope — wrap a service result in the HTTP envelope WITHOUT dropping
 * fields.
 *
 * The single-platform routes used to whitelist `overview/timeseries/metrics`, so
 * everything the services produce beyond those three (demographics, stage,
 * account, partialErrors, boards, level, totals…) only ever reached a client
 * through /api/combined. A per-channel refresh therefore returned LESS data than
 * the combined call: the Audience page went empty and partialErrors vanished.
 *
 * `extra` adds route-specific keys (Pinterest exposes meta.boards at top level).
 */
function platformEnvelope(platform, result, extra, opts) {
  const { platform: _ignored, meta, notice, ...data } = result || {};
  const payload = extra ? { ...data, ...extra } : data;
  // v4.3.0: every channel answers "why is this 0 and what do I do about it".
  // Optional and never fatal — a diagnosis bug must not blank a working channel.
  try {
    payload.diagnosis = diagnose(platform, payload, { audience: opts && opts.audience });
  } catch (e) {
    console.error(`[diagnosis] ${platform}:`, e.message);
  }
  return success({
    platform,
    meta: meta || {},
    data: payload,
    notice: notice || undefined,
  });
}

function errorResponse(err) {
  const p = parseError(err);
  // Services attach an actionable `hint`; it used to be dropped here, so the
  // dashboard could only show "IG_ALL_FAILED" with no way to fix it.
  const hint = err?.hint || p.details?.hint || null;
  console.error('[ERROR]', p.code, p.message, hint ? `| hint: ${hint}` : '');
  return {
    httpStatus: p.httpStatus,
    body: { success: false, error: { code: p.code, message: p.message, hint, details: p.details } },
  };
}
module.exports = { success, platformEnvelope, errorResponse };
