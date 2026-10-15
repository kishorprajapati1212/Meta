/**
 * /api/zernio — diagnostics + raw account/board reads for LinkedIn & Pinterest.
 *
 * These endpoints exist because "Pinterest shows nothing" is almost always a
 * Zernio-side problem (no account connected, analytics not on the plan,
 * external pins never synced). They answer that question in one call.
 */
const { Router } = require('express');
const { success, errorResponse } = require('../utils/response');
const zernio = require('../services/zernioService');
const config = require('../config');

const r = Router();

r.get('/debug', async (_req, res) => {
  try {
    const report = await zernio.debugZernio();
    res.json(success({ platform: 'zernio/debug', meta: { baseUrl: config.ZERNIO_BASE_URL }, data: report }));
  } catch (e) {
    const er = errorResponse(e);
    res.status(er.httpStatus).json(er.body);
  }
});

r.get('/accounts', async (_req, res) => {
  try {
    const all = await zernio.getAccounts(null);
    res.json(
      success({
        platform: 'zernio/accounts',
        meta: { error: all.error || null },
        data: {
          count: all.all.length,
          hasAnalyticsAccess: all.hasAnalyticsAccessRaw,
          accounts: all.all.map((a) => zernio.buildAccount(a)),
        },
      })
    );
  } catch (e) {
    const er = errorResponse(e);
    res.status(er.httpStatus).json(er.body);
  }
});

module.exports = r;
