const { Router } = require('express');
const { success } = require('../utils/response');
const axios = require('axios');
const config = require('../config');
const r = Router();
r.get('/', async (req, res) => {
  const st = { facebook:'untested', instagram:'untested', youtube:'untested', searchConsole:'untested', linkedin:'untested', pinterest:'untested' }; let ok = true;
  try { await require('../services/tokenService').getPageAccessToken(); st.facebook='ok'; st.instagram='ok'; } catch(e) { st.facebook=e.message; st.instagram=e.message; ok=false; }
  // YouTube  
  if(config.YOUTUBE_REFRESH_TOKEN&&config.GOOGLE_CLIENT_ID){try{const p=new URLSearchParams({client_id:config.GOOGLE_CLIENT_ID,client_secret:config.GOOGLE_CLIENT_SECRET,refresh_token:config.YOUTUBE_REFRESH_TOKEN,grant_type:'refresh_token'});await axios.post(config.GOOGLE_TOKEN_URL,p.toString(),{headers:{'Content-Type':'application/x-www-form-urlencoded'}});st.youtube='ok';}catch(e){st.youtube=e.response?.data?.error_description||e.message;ok=false;}}else{st.youtube='not_configured';}
  // GSC
  if(config.GSC_REFRESH_TOKEN&&config.GSC_CLIENT_ID){try{const p=new URLSearchParams({client_id:config.GSC_CLIENT_ID,client_secret:config.GSC_CLIENT_SECRET,refresh_token:config.GSC_REFRESH_TOKEN,grant_type:'refresh_token'});await axios.post(config.GOOGLE_TOKEN_URL,p.toString(),{headers:{'Content-Type':'application/x-www-form-urlencoded'}});st.searchConsole='ok';}catch(e){st.searchConsole=e.response?.data?.error_description||e.message;ok=false;}}else{st.searchConsole='not_configured';}
  // Zernio
  if(config.ZERNIO_API_KEY){try{const r2=await axios.get(config.ZERNIO_BASE_URL+'/v1/accounts',{headers:{Authorization:'Bearer '+config.ZERNIO_API_KEY},validateStatus:()=>true});if(r2.status===200){const accts=r2.data.accounts||[];st.linkedin=accts.find(a=>a.platform==='linkedin')?'ok':'no_account';st.pinterest=accts.find(a=>a.platform==='pinterest')?'ok':'no_account';}else{st.linkedin='HTTP '+r2.status;st.pinterest='HTTP '+r2.status;ok=false;}}catch(e){st.linkedin=e.message;st.pinterest=e.message;ok=false;}}else{st.linkedin='not_configured';st.pinterest='not_configured';}
  res.json(success({platform:'system',meta:{uptime:process.uptime()},data:{healthy:ok,platforms:st}}));
});
module.exports = r;