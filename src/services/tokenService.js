const axios = require('axios');
const config = require('../config');

let pageTokenCache = null;

async function getPageAccessToken() {
  if (pageTokenCache) return pageTokenCache;

  const { data } = await axios.get(
    `${config.FB_API_BASE}/${config.FB_API_VERSION}/me/accounts`,
    { params: { access_token: config.USER_ACCESS_TOKEN } }
  );

  if (!data.data || data.data.length === 0) {
    throw Object.assign(new Error('No Pages found. Check pages_show_list permission.'), { code: 'NO_PAGES_FOUND', httpStatus: 403 });
  }

  const page = data.data.find(p => p.id === config.FACEBOOK_PAGE_ID);
  if (!page) {
    const ids = data.data.map(p => p.id).join(', ');
    throw Object.assign(
      new Error(`Page ${config.FACEBOOK_PAGE_ID} not found. Available: [${ids}]`),
      { code: 'PAGE_NOT_FOUND', details: { availableIds: ids }, httpStatus: 404 }
    );
  }

  pageTokenCache = page.access_token;
  console.log(`[token] Page token acquired for "${page.name}"`);
  return pageTokenCache;
}

module.exports = { getPageAccessToken };
