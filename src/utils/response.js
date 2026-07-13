// Standardised response builders.
// Handles EVERY error shape — axios, raw API, Google, Facebook, plain objects.

function parseError(err) {
  const raw = {
    message: err.message || 'Unknown',
    responseStatus: err.response?.status,
    responseData: err.response?.data,
    code: err.code,
  };

  let apiMessage = '';
  let apiCode = '';
  let apiDetails = null;

  const body = err.response?.data;

  if (body) {
    // Google / YouTube: { error: { message, code, errors: [...] } }
    if (body.error && typeof body.error === 'object') {
      apiMessage = body.error.message || '';
      apiCode = String(body.error.code || '');
      apiDetails = body.error.errors || body.error;
    }
    // Facebook: { error: { message, type, code, ... } }
    else if (body.error && body.error.message) {
      apiMessage = body.error.message;
      apiCode = String(body.error.code || body.error.type || '');
      apiDetails = body.error;
    }
    // Body is a string
    else if (typeof body === 'string') {
      apiMessage = body;
    }
    // { message: '...' }
    else if (body.message) {
      apiMessage = body.message;
      apiDetails = body;
    }
    // Dump whatever we have
    else {
      apiMessage = JSON.stringify(body).slice(0, 500);
      apiDetails = body;
    }
  }

  if (!apiMessage) {
    if (err.code === 'ERR_BAD_REQUEST') {
      apiMessage = `Bad Request (HTTP ${err.response?.status || 400}). Raw: ${JSON.stringify(body || {}).slice(0, 300)}`;
    } else {
      apiMessage = err.message || 'Unknown error';
    }
  }

  if (!apiCode) {
    apiCode = err.code || (err.response?.status ? `HTTP_${err.response.status}` : 'UNKNOWN');
  }

  return {
    code: apiCode,
    message: apiMessage,
    details: apiDetails,
    _raw: raw,
    httpStatus: err.response?.status || err.httpStatus || 500,
  };
}

function success({ platform, meta = {}, data, errors, notice }) {
  const body = { success: true, platform, meta, data };
  if (errors && errors.length > 0) body.errors = errors;
  if (notice) body.notice = notice;
  return body;
}

function errorResponse(err) {
  const parsed = parseError(err);
  console.error('[ERROR]', JSON.stringify({ code: parsed.code, message: parsed.message, httpStatus: parsed.httpStatus }));
  return {
    httpStatus: parsed.httpStatus,
    body: {
      success: false,
      error: { code: parsed.code, message: parsed.message, details: parsed.details },
    },
  };
}

module.exports = { success, errorResponse };
