const axios = require('axios'); const config = require('../config');
let cache = null;
async function getPageAccessToken() {
  if (cache) return cache;
  const { data } = await axios.get(config.FB_API_BASE + '/' + config.FB_API_VERSION + '/me/accounts', { params: { access_token: config.USER_ACCESS_TOKEN } });
  if (!data.data || !data.data.length) throw Object.assign(new Error('No Pages found. Check pages_show_list permission.'), { code: 'NO_PAGES_FOUND', httpStatus: 403 });
  const page = data.data.find(p => p.id === config.FACEBOOK_PAGE_ID);
  if (!page) throw Object.assign(new Error('Page ' + config.FACEBOOK_PAGE_ID + ' not found'), { code: 'PAGE_NOT_FOUND', httpStatus: 404 });
  cache = page.access_token;
  console.log('[token] Page token acquired');
  return cache;
}
module.exports = { getPageAccessToken };
