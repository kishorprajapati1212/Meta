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
function errorResponse(err) {
  const p = parseError(err);
  console.error('[ERROR]', p.code, p.message);
  return { httpStatus: p.httpStatus, body: { success: false, error: { code: p.code, message: p.message, details: p.details } } };
}
module.exports = { success, errorResponse };
