const { Router } = require('express');
const { fetchInsights: fb } = require('../services/facebookService');
const { fetchInsights: ig } = require('../services/instagramService');
const { fetchInsights: yt } = require('../services/youtubeService');
const { success, errorResponse } = require('../utils/response');
const router = Router();

router.get('/', async (req, res) => {
  try {
    const [facebook, instagram, youtube] = await Promise.allSettled([
      fb(req.query).catch(e => e),
      ig(req.query).catch(e => e),
      yt(req.query).catch(e => e),
    ]);

    const result = {};
    if (facebook.value && !(facebook.value instanceof Error)) result.facebook = facebook.value;
    else result.facebook = errorResponse(facebook.value || facebook.reason).body;
    if (instagram.value && !(instagram.value instanceof Error)) result.instagram = instagram.value;
    else result.instagram = errorResponse(instagram.value || instagram.reason).body;
    if (youtube.value && !(youtube.value instanceof Error)) result.youtube = youtube.value;
    else result.youtube = errorResponse(youtube.value || youtube.reason).body;

    res.json(success({ platform: 'combined', meta: {}, data: result }));
  } catch (err) { const e = errorResponse(err); res.status(e.httpStatus).json(e.body); }
});

module.exports = router;
