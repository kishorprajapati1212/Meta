/**
 * diagnosis.js — turns a platform payload into "why is this 0, and what do I do".
 *
 * v4.3.0. The reported problem: most cards read 0 and the dashboard could only
 * say "no data". A 0 has at least five completely different causes, and each one
 * needs a different action:
 *
 *   unpublished    the platform's API does not publish this number at all
 *                  (Pinterest followers, LinkedIn personal-profile followers)
 *   lag            the post is too new — Pinterest/Zernio fill in after 24–48 h
 *   no-content     nothing was published in this range
 *   no-distribution the platform showed it to (almost) nobody — the algorithm
 *                  never picked it up. This is NOT an engagement problem.
 *   not-reported   the platform knows the content (real id + URL, marked
 *                  synced) but returns no metrics for it at all — the account
 *                  is not entitled to analytics. 0 here means "not measured",
 *                  which is a different problem from "nobody saw it".
 *   seen-not-engaged people saw it and did not act — a format/CTA problem
 *   no-conversion    engagement happened but nobody clicked through
 *
 * Everything here is computed from numbers the API actually returned. The
 * reference ranges in BENCHMARKS are published 2026 industry figures and are
 * always labelled as references — they are never presented as the user's data.
 */

// ────────────────────────────────────────────────────────────────
// Reference ranges (2026). Sources: Hootsuite "Average engagement rate
// benchmarks: 13 industries (2026)", Socialinsider LinkedIn Benchmarks 2026,
// Quid/Rival IQ 2026 industry tables, SociaVault Labs 2026 follower-tier study,
// PostEverywhere 2026 organic CTR table.
// ────────────────────────────────────────────────────────────────
const BENCHMARKS = {
  facebook: {
    engagementRate: { typical: '2.9% average · 5.2% for education', tier: 'nano pages (<5K) sit at the top of the range' },
    reach: { typical: '~3–6% of followers per organic post' },
    note: 'Education is one of the three highest-engagement industries on Facebook. Meaningful interactions (comments, shares) are what the feed rewards — passive video views barely count.',
  },
  instagram: {
    engagementRate: { typical: '1.8% average · 2.1% for higher education', tier: '≈3.4% median for accounts under 10K followers' },
    reach: { typical: '~3.2% of followers per post' },
    note: 'Saves and shares are the strongest ranking signals; carousels are the best-performing format (~4.2%). Accounts under 10K followers get the highest engagement rates of any tier — a small audience is an advantage here, not a handicap.',
  },
  youtube: {
    engagementRate: { typical: '3–5% of views' },
    reach: { typical: 'impression CTR 2–10%, average view duration 40–50%' },
    note: 'Ranking is CTR × average view duration. Education and how-to is the single highest-engagement niche cross-platform (≈3.9%), and YouTube is a search engine: a video keeps finding viewers for years.',
  },
  linkedin: {
    engagementRate: { typical: '3.9% average · 3.0–4.0% for education (highest of any industry)', tier: '≈5.6% median for accounts under 5K followers' },
    reach: { typical: 'personal profiles ≈4.7% median vs 1–2% for company pages' },
    note: 'Document/carousel posts lead at ≈7% engagement. Dwell time and comments in the first hour decide distribution; a bare external link suppresses reach, so put links in the first comment.',
  },
  pinterest: {
    engagementRate: { typical: '1.9% average', tier: '≈3.2% median for accounts under 5K followers' },
    reach: { typical: 'outbound CTR ≈1.5% — the highest of any platform' },
    note: 'Pins are indexed like search results, not like a feed. A fresh pin usually takes 2–4 weeks before impressions appear, and it can keep driving traffic for months. Keywords in the pin title and board name do the targeting.',
  },
  searchConsole: {
    engagementRate: { typical: 'CTR depends on position: ~27% at #1, ~15% at #2, ~11% at #3' },
    reach: { typical: 'average position 11+ is effectively invisible' },
    note: 'This is the only channel where an institution actively searches for a product. Ranking for the phrase a registrar or HOD would type is worth more than any social post.',
  },
};

/** How well each channel reaches the two possible audiences. */
const AUDIENCE_FIT = {
  institutions: {
    linkedin: { fit: 'high', why: 'Heads of department, placement cells, registrars and edtech buyers are all here — and education is LinkedIn\'s highest-engagement industry.' },
    searchConsole: { fit: 'high', why: 'A university evaluating a product searches for it. This is where that intent lands.' },
    youtube: { fit: 'high', why: 'Committees watch a 3-minute demo before replying to an email; faculty search "how to" constantly.' },
    facebook: { fit: 'medium', why: 'Faculty and parent groups, and university pages still live here — good for credibility, weak for buying decisions.' },
    instagram: { fit: 'low', why: 'Students and campus life, not procurement. Useful as proof-of-work a decision-maker might be sent, not as the pitch channel.' },
    pinterest: { fit: 'low', why: 'Resource and lesson-planning searches exist, but institutions do not buy from Pinterest.' },
  },
  students: {
    instagram: { fit: 'high', why: 'Where students actually spend attention; saves and shares spread campus content.' },
    youtube: { fit: 'high', why: 'Tutorials and demos are searched directly by students.' },
    pinterest: { fit: 'medium', why: 'Study aesthetics, notes and project inspiration are evergreen search traffic.' },
    linkedin: { fit: 'medium', why: 'Final-year students and placement season — internships and resumes.' },
    facebook: { fit: 'low', why: 'College groups still exist, but the under-25 audience has largely left.' },
    searchConsole: { fit: 'medium', why: 'Students search for solutions too, just with different words.' },
  },
};

const CHANNEL_MECHANICS = {
  facebook: 'Feed distribution depends on meaningful interaction in the first hours. Ask a question, reply to every comment, and post when your audience is online.',
  instagram: 'Saves and shares decide whether a post is re-served. Carousels with a takeaway on every slide, a hook in the first frame, and a "save this" CTA outperform single images.',
  youtube: 'Thumbnail + title decide CTR; the first 30 seconds decide watch time. Both together decide impressions. Chapters and a clear payoff in the title help search.',
  linkedin: 'Text-with-image and document/carousel posts get the most dwell time. Post from a personal profile, tag the institution, and put any external link in the first comment.',
  pinterest: 'Keyword-rich pin titles, vertical 2:3 creative, and boards named for what an institution would search ("college attendance tracking", "campus management"). Volume and consistency beat virality.',
  searchConsole: 'Titles and meta descriptions decide CTR at a given position. Target the exact phrase a decision-maker types, and answer it in the first paragraph.',
};

const LAG_MS = 48 * 3600 * 1000; // Pinterest/Zernio analytics lag
/**
 * Which card answers "was it seen?". Meta retired `page_impressions` for some
 * Pages, and the live capture of 2026-10-21 showed a Facebook payload with no
 * impressions card at all but `contentViews: 36` — reading only
 * impressions/reach/views made the diagnosis claim "the algorithm served them to
 * nobody" over 36 measured views. The list is ordered most-preferred first, and
 * `firstValue` takes the first card that actually has a number.
 */
const SEEN_KEYS = {
  facebook: ['impressions', 'reach', 'contentViews', 'uniqueViewers', 'views', 'pageViews'],
  instagram: ['impressions', 'reach', 'views', 'contentViews'],
  youtube: ['views', 'impressions', 'reach'],
  linkedin: ['impressions', 'reach', 'views'],
  pinterest: ['impressions', 'reach', 'views'],
  searchConsole: ['impressions', 'reach', 'views'],
  default: ['impressions', 'reach', 'views'],
};

// Fewer impressions than this per post means the platform barely showed the
// content at all — real capture 2026-10-21: 8 LinkedIn posts, 93 impressions in
// 90 days (≈12 per post). Everything downstream of reach is then unjudgeable.
const LOW_REACH_PER_POST = 100;
// Feed-style channels where "seen" means the algorithm chose to show the post.
const LOW_REACH_PLATFORMS = new Set(['facebook', 'instagram', 'linkedin', 'pinterest']);
/** Metrics that count as engagement when the account-level card is empty. */
const ENGAGEMENT_KEYS = [
  'likes', 'comments', 'shares', 'saves', 'saves_and_reposts', 'engagement', 'interactions',
  'total_interactions', 'reposts', 'sends', 'replies', 'follows', 'closeups', 'accountsEngaged',
];

/**
 * What counts as engagement is not the same on every channel: Pinterest has no
 * like button (a pin click IS the engagement), a search click is both the
 * engagement and the conversion, and LinkedIn calls them reactions.
 */
const ENGAGED_KEYS = {
  pinterest: ['engagement', 'saves', 'clicks', 'closeups'],
  searchConsole: ['clicks'],
  linkedin: ['engagement', 'interactions', 'likes', 'comments', 'shares', 'saves', 'saves_and_reposts', 'reposts', 'sends'],
  youtube: ['engagement', 'interactions', 'likes', 'comments', 'shares'],
  default: ['engagement', 'interactions', 'total_interactions', 'likes', 'comments', 'shares', 'saves'],
};

/** Same idea, for summing the individual posts when the account card is empty. */
const POST_ENGAGED_KEYS = {
  pinterest: ['clicks', 'saves'],
  searchConsole: ['clicks'],
  default: ['likes', 'comments', 'shares', 'saves'],
};

/** Where a click leads. `null` = the channel has no separate destination metric. */
const CONVERTED_KEYS = {
  pinterest: ['outboundClicks', 'websiteClicks'],
  searchConsole: null,
  linkedin: ['clicks', 'websiteClicks', 'profileVisits'],
  default: ['clicks', 'outboundClicks', 'websiteClicks', 'profileVisits', 'profileViews', 'searchClicks', 'pageViews'],
};

/** Route names that differ from the canonical platform key. */
const PLATFORM_ALIAS = { gsc: 'searchConsole', google: 'searchConsole', search_console: 'searchConsole' };

const ZERNIO_PLATFORMS = new Set(['pinterest', 'linkedin']);

function card(ov, key) {
  const c = ov && ov[key];
  return c && typeof c === 'object' && !Array.isArray(c) ? c : null;
}

function num(c) {
  if (!c || c.unavailable === true) return null;
  const v = Number(c.total ?? c.value);
  return Number.isFinite(v) ? v : null;
}

/** First card in `keys` that has a real (non-null) number. */
function firstValue(ov, keys) {
  for (const k of keys) {
    const v = num(card(ov, k));
    if (v !== null && v > 0) return { key: k, value: v };
  }
  const present = keys.map((k) => num(card(ov, k))).filter((v) => v !== null);
  return { key: keys[0], value: 0, measurable: present.length > 0 };
}

function newestPostDate(payload) {
  const posts = payload?.posts || payload?.topPosts || [];
  let newest = 0;
  for (const p of posts) {
    const t = new Date(p.publishedAt || p.date || 0).getTime();
    if (Number.isFinite(t) && t > newest) newest = t;
  }
  return newest || null;
}

function fmt(n) {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  if (Math.abs(n) >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (Math.abs(n) >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return String(Math.round(n * 100) / 100);
}

/**
 * diagnose — the funnel, the blocked stage, the reason behind every zero, and
 * what to do next for the chosen audience.
 *
 * @param {string} platform  facebook | instagram | youtube | linkedin | pinterest | searchConsole
 * @param {object} payload   a service result (overview/timeseries/posts/meta/…)
 * @param {object} opts      { audience: 'institutions' | 'students' }
 */
function diagnose(rawPlatform, payload, opts = {}) {
  const audience = AUDIENCE_FIT[opts.audience] ? opts.audience : 'institutions';
  // /api/gsc is the route name; every table below (and the dashboard) keys the
  // channel as searchConsole. Normalising here means one canonical diagnosis
  // whichever endpoint produced it.
  const platform = PLATFORM_ALIAS[String(rawPlatform || '')] || String(rawPlatform || '');
  const p = payload || {};
  const ov = p.overview || {};
  const rawPosts = p.posts || p.topPosts || [];
  // A malformed payload (or a service that could not read the post list) must
  // not take the whole diagnosis down with it.
  const posts = Array.isArray(rawPosts) ? rawPosts.filter((x) => x && typeof x === 'object') : [];
  const bench = BENCHMARKS[platform] || {};
  const fit = (AUDIENCE_FIT[audience] || {})[platform] || { fit: 'medium', why: '' };

  const published =
    num(card(ov, 'posts')) ?? (p.meta?.postCount != null ? Number(p.meta.postCount) : null) ?? (posts.length || null);

  const seen = firstValue(ov, SEEN_KEYS[platform] || SEEN_KEYS.default);
  const engaged = firstValue(ov, ENGAGED_KEYS[platform] || ENGAGED_KEYS.default);
  const followersCard = card(ov, 'followers');
  const followers = num(followersCard);
  const convertedKeys = platform in CONVERTED_KEYS ? CONVERTED_KEYS[platform] : CONVERTED_KEYS.default;
  const converted = convertedKeys ? firstValue(ov, convertedKeys) : { key: 'clicks', value: null };

  // Engagement summed from the individual posts when the account-level card is
  // empty — this is what "my Instagram has likes but the card says 0" needs.
  // Per-key sums from the posts. The account-level card is often empty while the
  // posts carry the truth — but a card may only be credited with ITS OWN sum. The
  // old code quoted the grand total on every empty card, so a YouTube "Comments"
  // card claimed "your posts record 11 interactions" when 11 was likes+shares and
  // comments really were 0.
  const postSums = {};
  const postKeys = POST_ENGAGED_KEYS[platform] || POST_ENGAGED_KEYS.default;
  for (const post of posts) {
    const a = post.analytics || {};
    for (const k of postKeys) postSums[k] = (postSums[k] || 0) + (Number(a[k]) || 0);
  }
  const engagementFromPosts = Object.values(postSums).reduce((sum, v) => sum + v, 0);

  const youngPosts = posts.filter((post) => {
    const t = new Date(post.publishedAt || post.date || 0).getTime();
    return Number.isFinite(t) && Date.now() - t < LAG_MS;
  }).length;
  const lagging =
    ZERNIO_PLATFORMS.has(platform) && (published || 0) > 0 && seen.value === 0 && youngPosts > 0;

  // ── "the platform is not reporting metrics at all" ────────────────
  // Real evidence, captured 2026-10-21 from the live account (90-day window,
  // scripts/fixtures/zernio-real-pinterest.json): Pinterest returned 6 pins,
  // each with a real pin id and pin URL and syncStatus "synced" — so Zernio
  // definitely knows the pins — yet every metric was 0, including pins 9 to 33
  // days old (far beyond Pinterest's 24–48 h reporting lag), and every
  // account-level gauge (pin count, board count, monthly views, account type)
  // came back empty. Pinterest only serves organic analytics to BUSINESS
  // accounts, so that combination means "not measured", not "nobody saw it".
  // The LinkedIn copy of the very same cross-post did report impressions, which
  // is what keeps this from firing on a channel that is merely under-reached.
  const agedPosts = posts.filter((post) => {
    const t = new Date(post.publishedAt || post.date || 0).getTime();
    return Number.isFinite(t) && Date.now() - t >= LAG_MS;
  });
  const oldestDays = posts.reduce((max, post) => {
    const t = new Date(post.publishedAt || post.date || 0).getTime();
    return Number.isFinite(t) ? Math.max(max, Math.floor((Date.now() - t) / 86400000)) : max;
  }, 0);
  const identifiedPosts = posts.filter((post) => post.postId || post.platformUrl).length;
  const syncedPosts = posts.filter((post) => String(post.syncStatus || '').toLowerCase() === 'synced').length;
  const acct = p.meta?.account || {};
  const gaugesEmpty = ['pinCount', 'boardCount', 'monthlyViews'].every(
    (k) => acct[k] === null || acct[k] === undefined
  );
  const allPostsZero =
    posts.length > 0 &&
    engagementFromPosts === 0 &&
    posts.every((post) => {
      const a = post.analytics || {};
      return ['impressions', 'reach', 'views', 'clicks', 'saves', 'likes', 'comments', 'shares', 'outboundClicks'].every(
        (k) => !Number(a[k])
      );
    });
  // Pinterest-only on purpose: this is the one channel where the evidence above
  // was observed and where the platform documents the business-account
  // requirement. An all-zero LinkedIn feed stays a distribution question.
  const notReported =
    platform === 'pinterest' &&
    allPostsZero &&
    seen.value === 0 &&
    identifiedPosts === posts.length &&
    syncedPosts > 0 &&
    agedPosts.length > 0 &&
    gaugesEmpty;

  // ── reach so small that nothing downstream can be judged from it ──
  const seenPerPost = published && seen.value > 0 ? Math.round((seen.value / published) * 10) / 10 : null;
  // Only for channels whose "seen" stage is an impression/reach count. YouTube's
  // is views and Search Console's is search impressions — a small number there
  // is not a distribution failure, so this must not fire on them.
  // contentViews / uniqueViewers are Meta's surviving reach proxies now that
  // page_impressions is retired for many Pages, so they count as reach-like.
  const reachLikeKey = ['impressions', 'reach', 'contentviews', 'uniqueviewers'].includes(
    String(seen.key || '').toLowerCase()
  );
  const lowReach =
    !notReported &&
    seenPerPost !== null &&
    seenPerPost < LOW_REACH_PER_POST &&
    reachLikeKey &&
    LOW_REACH_PLATFORMS.has(platform);


  // ── funnel ──
  const stage = (key, label, value, extra = {}) => ({
    key,
    label,
    value: value === null ? null : Number(value),
    display: value === null ? 'not published' : fmt(value),
    verdict: value === null ? 'unavailable' : Number(value) > 0 ? 'ok' : 'zero',
    ...extra,
  });

  const funnel = [
    stage('published', 'Published', published, {
      note: published > 0 ? `${published} item(s) in this range` : 'Nothing published in this range',
    }),
    stage('seen', 'Seen', seen.value, {
      sourceKey: seen.key,
      note:
        seen.value > 0
          ? lowReach
            ? `${fmt(seen.value)} ${seen.key} — only ${seenPerPost} per post, which is why nothing downstream moved`
            : `${fmt(seen.value)} ${seen.key}`
          : notReported
          ? `${identifiedPosts} item(s) are known to the platform (real id + URL, marked synced) but it returns no metrics for them`
          : lagging
          ? `${youngPosts} item(s) published in the last 48 h — this platform has not processed them yet`
          : published > 0
          ? 'The platform showed it to (almost) nobody'
          : 'Nothing to show yet',
    }),
    stage('engaged', 'Engaged', engaged.value || engagementFromPosts || 0, {
      sourceKey: engaged.value ? engaged.key : engagementFromPosts ? 'summed from posts' : engaged.key,
      note:
        engaged.value > 0
          ? `${fmt(engaged.value)} ${engaged.key}`
          : engagementFromPosts > 0
          ? `${fmt(engagementFromPosts)} summed from your posts — the account-level card is empty`
          : seen.value > 0
          ? 'People saw it and did not act'
          : 'No engagement yet',
    }),
    followersCard && followersCard.unavailable === true
      ? stage('followed', 'Followers', null, { note: followersCard.unavailableReason || 'This platform does not publish a follower count.' })
      : stage('followed', 'Followers', followers, { note: followers > 0 ? `${fmt(followers)} followers` : 'No follower growth measurable in this range' }),
    stage('converted', convertedKeys ? 'Clicked through' : 'Converted', converted.value, {
      sourceKey: converted.key,
      ...(converted.value === null
        ? {
            display: 'same as clicks',
            note: 'A search click is both the engagement and the conversion here — Search Console has no separate destination metric.',
          }
        : { note: converted.value > 0 ? `${fmt(converted.value)} ${converted.key}` : 'Nobody clicked through' }),
    }),
  ];

  const funnelRaw = funnel;

  // ── which stage is blocking growth ──
  const engagedTotal = engaged.value || engagementFromPosts || 0;
  // A channel that answered with an error has no growth problem to diagnose —
  // saying "publish more" over a credentials failure is how dashboards get
  // ignored. Say what broke instead.
  const failed = typeof p.error === 'string' && p.error.length > 0;
  let blocked = 'healthy';
  let headline = '';
  if (failed) {
    blocked = 'unreachable';
    headline = `This channel could not be read: ${p.error}${p.hint ? ` — ${p.hint}` : ''}. Until it answers, every number below is missing rather than zero.`;
  } else if (published === 0) {
    // A known 0 — the API reported a post count, or returned an empty list it
    // was able to read. An *unknown* count (null) must not be called idleness.
    blocked = 'no-content';
    headline = 'Nothing was published in this range, so the algorithm had nothing to distribute. Cadence is the whole problem here.';
  } else if (notReported) {
    blocked = 'not-reported';
    headline = `${published} pin(s) are known to Pinterest — each has a real pin id and URL and is marked synced — yet every metric is 0, including pins up to ${oldestDays} days old (well past the 24–48 h reporting lag), and every account-level gauge (pin count, board count, monthly views, account type) is empty too. Pinterest only serves organic analytics to BUSINESS accounts, so these zeros mean "not measured", not "nobody saw them". Do not rewrite the content over this number — fix the account type first.`;
  } else if (seen.value === 0) {
    blocked = lagging ? 'pending-lag' : 'no-distribution';
    headline = lagging
      ? `${youngPosts} item(s) are under 48 h old and this platform has not reported impressions for them yet. This resolves on its own — check again tomorrow.`
      : published === null
      ? `The platform recorded 0 ${seen.key} in this range and did not report a post count, so either nothing was published or the algorithm served it to nobody. Check the channel's own post list, then treat it as a distribution problem.`
      : `You published ${published} item(s) and the algorithm served them to nobody — 0 ${seen.key}. This is a distribution problem, not an engagement problem: the platform is not pushing the content, so no amount of creative polish moves these numbers until reach exists.`;
  } else if (engagedTotal === 0) {
    blocked = 'seen-not-engaged';
    headline = `${fmt(seen.value)} ${seen.key} but zero engagement. The content is being distributed and people are not acting on it — the format, hook or call to action is what needs changing.`;
  } else if (followers !== null && followers === 0) {
    blocked = 'engaged-not-followed';
    headline = 'Engagement is happening but the audience is not accumulating — there is no reason given to follow, and no series to follow for.';
  } else if (converted.value === 0 && convertedKeys) {
    blocked = 'no-conversion';
    headline = `${fmt(seen.value)} ${seen.key} and ${fmt(engagedTotal)} engagement, but 0 ${converted.key}. Attention exists; there is no path from the post to the destination.`;
  } else {
    headline = `The funnel is working end to end: ${
      published === null ? 'published (this channel reports no post count)' : `${fmt(published)} published`
    } → ${fmt(seen.value)} ${seen.key} → ${fmt(engagedTotal)} engagement${
      convertedKeys ? ` → ${fmt(converted.value)} ${converted.key}` : ' (the click is the conversion here)'
    }. Now scale what already works.`;
  }

  // Reach is the binding constraint: say so on top of whatever stage blocked.
  if (lowReach) {
    headline += ` Reach is the binding constraint here: ${seenPerPost} ${seen.key} per post across ${published} post(s) — the platform showed this content to almost nobody, so there was never a real chance for it to convert.`;
  }

  // ── every zero card, with its real reason ──
  const zeros = [];
  for (const [key, c] of Object.entries(ov)) {
    if (!c || typeof c !== 'object' || Array.isArray(c)) continue;
    if (!('total' in c) && !('value' in c)) continue;
    const v = num(c);
    if (v === null) {
      zeros.push({
        key,
        label: c.label || key,
        reason: 'unpublished',
        explanation: c.unavailableReason || `${platform} does not publish ${c.label || key} through its API, so this card was removed instead of showing a false 0.`,
      });
      continue;
    }
    if (v > 0) continue;
    if (engagementFromPosts > 0 && ENGAGEMENT_KEYS.includes(key)) {
      const own = Number(postSums[key]) || 0;
      const label = String(c.label || key).toLowerCase();
      zeros.push(
        own > 0
          ? {
              key,
              label: c.label || key,
              reason: 'recovered-from-posts',
              explanation:
                `The account-level ${label} insight is empty for this range, but your posts record ${fmt(own)} ${label} ` +
                `between them (${fmt(engagementFromPosts)} interaction(s) in total across all metrics) — ${fmt(own)} is the number the funnel above uses. ` +
                `${platform} reports this per post rather than per account for newer business profiles.`,
              source: c.source || 'summed from posts',
            }
          : {
              // Posts were read and this metric really is 0 on every one of them.
              // That is a measurement, not a gap — so it must not borrow the
              // total from the metrics that did move.
              key,
              label: c.label || key,
              reason: 'no-activity',
              explanation:
                `No ${label} on any of the ${posts.length} post(s) read in this range (they recorded ${fmt(engagementFromPosts)} other interaction(s) between them), ` +
                `and the account-level ${label} insight is empty too. This is a measured zero, not a missing metric.`,
              source: c.source || 'summed from posts',
            }
      );
      continue;
    }
    let reason = 'no-activity';
    let explanation = `No ${String(c.label || key).toLowerCase()} recorded in this range.`;
    if (failed) {
      reason = 'unreachable';
      explanation = `This channel answered with an error, so the card has no value to report: ${String(p.error).slice(0, 160)}`;
    } else if (published === 0) {
      reason = 'no-content';
      explanation = 'Nothing was published in this range, so there was nothing to measure.';
    } else if (notReported) {
      reason = 'not-reported';
      explanation = `Pinterest returned this pin (id and URL are known, syncStatus "synced") but reported no metrics for it — the oldest such pin is ${oldestDays} day(s) old, so this is not the 24–48 h lag. Organic analytics are only served for Pinterest BUSINESS accounts.`;
    } else if (seen.value === 0 && lagging) {
      reason = 'lag';
      explanation = `Your newest item is under 48 h old and this platform has not reported metrics for it yet. Refresh tomorrow.`;
    } else if (seen.value === 0) {
      reason = 'no-distribution';
      explanation = `Zero because the platform recorded 0 ${seen.key} — the content was not shown, not shown-and-ignored.`;
    } else if (key !== seen.key && ENGAGEMENT_KEYS.includes(key)) {
      reason = 'seen-not-engaged';
      explanation = `${fmt(seen.value)} ${seen.key} reached people and none of them acted.`;
    } else if (['clicks', 'outboundClicks', 'websiteClicks', 'profileVisits', 'profileViews'].includes(key)) {
      reason = 'no-conversion';
      explanation = 'Attention existed but nothing pointed at a destination, or the destination was not worth the click.';
    }
    zeros.push({ key, label: c.label || key, reason, explanation, ...(c.source ? { source: c.source } : {}) });
  }
  // A failed channel gets one explanation (the error), not one per empty card.
  const zerosOut = failed ? zeros.slice(0, 1) : zeros;

  // ── actions: platform × audience × blocked stage ──
  const actions = [];
  const targetWord = audience === 'institutions' ? 'universities and departments' : 'students';
  if (blocked === 'unreachable') {
    actions.push({
      priority: 1,
      title: 'Restore the connection before judging the content',
      detail: `${String(p.error || '').slice(0, 200)}${p.hint ? ` ${p.hint}` : ''} Open the Connections page, re-check this channel's credentials, then refresh. No growth decision should be made from a channel that could not be read.`,
      effort: 'first',
    });
  }
  if (blocked === 'no-content') {
    actions.push({
      priority: 1,
      title: `Publish for ${targetWord} on a fixed cadence`,
      detail: `Two to three posts a week for four weeks is enough for ${platform} to classify the account. One-off posts never accumulate distribution.`,
    });
  }
  if (blocked === 'no-distribution') {
    actions.push({
      priority: 1,
      title: 'Fix distribution before creative',
      detail: `${CHANNEL_MECHANICS[platform] || ''} With 0 ${seen.key} recorded, the algorithm has no signal to work from — early interaction from real people (a department group, a faculty share, a comment within the first hour) is what starts it.`,
    });
    actions.push({
      priority: 2,
      title: `Write for the ${audience === 'institutions' ? 'decision-maker' : 'student'} search, not the feed`,
      detail:
        audience === 'institutions'
          ? `Name the institution type and the outcome in the first line ("For colleges running manual attendance…"). Committees share content that names their problem; students do not amplify it for you.`
          : 'Name the outcome in the first line ("Present in 4 seconds from your bench"). Students share what makes them look clever to their friends.',
    });
  }
  if (blocked === 'seen-not-engaged') {
    actions.push({
      priority: 1,
      title: 'Change the format, not the topic',
      detail: bench.note || CHANNEL_MECHANICS[platform] || '',
    });
    actions.push({
      priority: 2,
      title: 'Give one reason to act',
      detail: 'A single explicit ask ("save this for your next faculty meeting", "comment your college name") outperforms three implicit ones.',
    });
  }
  if (blocked === 'engaged-not-followed') {
    actions.push({
      priority: 1,
      title: 'Make the account a series',
      detail: `People follow a recurring format aimed at ${targetWord}, not a set of unrelated updates. Name the series and post it on the same day each week.`,
    });
  }
  if (blocked === 'no-conversion') {
    actions.push({
      priority: 1,
      title: 'Put one destination in every post',
      detail:
        platform === 'linkedin'
          ? 'Link in the first comment, and a reason to click ("the 2-minute demo for a placement cell").'
          : platform === 'pinterest'
          ? 'Every pin needs a keyword title and a link — Pinterest is the highest outbound-CTR platform (~1.5%) and the click is the whole point.'
          : 'One link, one CTA, above the fold.',
    });
  }
  if (blocked === 'healthy') {
    actions.push({
      priority: 1,
      title: 'Scale the format that produced this',
      detail: `Repeat the top-performing item's structure for ${targetWord} and put a small budget or a partner share behind it.`,
    });
  }
  if (blocked === 'not-reported') {
    actions.push({
      priority: 1,
      title: `Convert ${acct.username ? `@${acct.username}` : 'the Pinterest account'} to a Business account (free)`,
      detail:
        'Pinterest only serves organic analytics — impressions, saves, pin clicks, outbound clicks — to Business accounts. In Pinterest: Settings → Account management → Convert to business. Nothing about the account name, boards or pins changes, and it is free. This is the one change that makes every Pinterest card on this dashboard fill in.',
      effort: '5 minutes',
    });
    const perms = Array.isArray(acct.permissions) ? acct.permissions : [];
    const readsGranted = perms.filter((x) => /read/i.test(String(x)));
    actions.push({
      priority: 2,
      title: 'Reconnect Pinterest in Zernio after converting',
      detail: readsGranted.length
        ? `The token already grants ${readsGranted.join(', ')} and the connection is marked ${acct.platformStatus || 'active'}${
            acct.connectedAt ? ` (connected ${String(acct.connectedAt).slice(0, 10)})` : ''
          } — so no scope is missing and re-authorising on its own changes nothing. Reconnect only AFTER the account is a Business account, so Pinterest re-evaluates the entitlement.`
        : `The connection was authorised while the account was not a business account${
            acct.connectedAt ? ` (connected ${String(acct.connectedAt).slice(0, 10)})` : ''
          }. Disconnect and reconnect after converting so the new entitlement is picked up (pins:read, boards:read, user_accounts:read).`,
      effort: '5 minutes',
    });
    actions.push({
      priority: 3,
      title: 'Until then, read the truth in Pinterest itself',
      detail: `pinterest.com/analytics (business accounts only) shows impressions per pin. Cross-check one of the ${identifiedPosts} pins listed below: if Pinterest shows impressions there while this dashboard shows 0, the gap is the connection — not your content.`,
    });
    actions.push({
      priority: 4,
      title: `Keep pinning for ${targetWord} regardless`,
      detail: `${CHANNEL_MECHANICS[platform] || ''} A pin is indexed like a search result, so the work is not wasted — it just cannot be measured from here until the account entitlement is fixed.`,
    });
  }
  if (blocked === 'pending-lag') {
    actions.push({
      priority: 1,
      title: 'Wait out the reporting lag',
      detail: 'This platform reports metrics 24–48 h after publication. Nothing is broken; the numbers appear on their own.',
    });
    actions.push({
      priority: 2,
      title: 'Publish the next item now',
      detail: 'Consistency is what compounds on this platform — the lag makes a weekly cadence look empty for the first two days.',
    });
  }

  if (lowReach) {
    for (const a of actions) a.priority += 1;
    actions.unshift({
      priority: 1,
      title: 'Fix reach before anything else',
      detail: `${CHANNEL_MECHANICS[platform] || ''} At ${seenPerPost} ${seen.key} per post the algorithm is not distributing this content, so no headline, thumbnail or CTA change can be evaluated yet. Post 2–3× a week for four weeks, get a real person to engage within the first hour, and keep any destination link out of the post body — a bare link suppresses reach.`,
      effort: '4 weeks',
    });
  }

  const benchmark = bench.engagementRate
    ? {
        metric: 'engagement rate',
        // No reach means no rate: printing 0% would compare a missing
        // measurement against a real benchmark.
        yours: engagedTotal && seen.value > 0 ? Math.round((engagedTotal / seen.value) * 10000) / 100 : null,
        ...(notReported
          ? {
              note: `${bench.note || ''} Not comparable right now: Pinterest is not reporting any metrics for this account, so there is no rate to measure.`.trim(),
            }
          : {}),
        typical: bench.engagementRate.typical,
        tier: bench.engagementRate.tier || null,
        reference: 'Published 2026 industry benchmarks (Hootsuite, Socialinsider, Quid/Rival IQ, SociaVault) — a reference range, not your data.',
        note: bench.note || null,
      }
    : null;

  return {
    platform,
    audience,
    audienceFit: fit,
    stage: blocked,
    headline,
    funnel: failed
      ? funnelRaw.map((f) => ({
          ...f,
          value: null,
          display: 'not read',
          verdict: 'unavailable',
          note: 'This channel answered with an error, so the stage has no value.',
        }))
      : funnelRaw,
    zeros: zerosOut,
    benchmark,
    actions,
    mechanics: CHANNEL_MECHANICS[platform] || null,
    evidence: {
      published: published || 0,
      seen: seen.value,
      seenKey: seen.key,
      engaged: engagedTotal,
      engagedSource: engaged.value ? 'account metric' : engagementFromPosts ? 'summed from posts' : null,
      postSums,
      followers,
      followersPublished: followers !== null,
      converted: converted.value,
      convertedKey: converted.key,
      youngPosts,
      lagging,
      postsRead: posts.length,
      notReported,
      seenPerPost,
      lowReach,
      identifiedPosts,
      syncedPosts,
      agedPosts: agedPosts.length,
      oldestPostDays: oldestDays || null,
      accountGaugesEmpty: gaugesEmpty,
      accountPermissions: Array.isArray(acct.permissions) ? acct.permissions : null,
      accountPlatformStatus: acct.platformStatus || null,
    },
  };
}

/**
 * focusOrder — rank the channels for a cross-channel "where to spend this week"
 * list. Unblocking a dead channel beats polishing a working one, weighted by how
 * well the channel reaches the chosen audience.
 */
const FIT_WEIGHT = { high: 1.5, medium: 1, low: 0.6 };
const STAGE_WEIGHT = {
  unreachable: 3.2,
  // A channel that cannot be measured blocks every judgement made from it, so
  // it ranks just under a channel that is fully unreadable.
  'not-reported': 2.9,
  'no-distribution': 3,
  'no-content': 2.6,
  'seen-not-engaged': 2.2,
  'no-conversion': 1.8,
  'engaged-not-followed': 1.6,
  'pending-lag': 0.8,
  healthy: 1.2,
};

function focusOrder(diagnoses, audience = 'institutions') {
  const list = (diagnoses || []).filter(Boolean);
  return list
    .map((d) => {
      const key = PLATFORM_ALIAS[d.platform] || d.platform;
      const fit = (AUDIENCE_FIT[audience] || {})[key] || d.audienceFit || { fit: 'medium', why: '' };
      const score = (STAGE_WEIGHT[d.stage] ?? 1) * (FIT_WEIGHT[fit.fit] ?? 1);
      return {
        platform: d.platform,
        stage: d.stage,
        headline: d.headline,
        audienceFit: fit.fit,
        audienceWhy: fit.why,
        score: Math.round(score * 100) / 100,
        // A string, not the action object: the dashboard prints it directly.
        firstAction: (d.actions[0] && d.actions[0].title) || null,
        firstActionDetail: (d.actions[0] && d.actions[0].detail) || null,
      };
    })
    .sort((a, b) => b.score - a.score);
}

module.exports = { diagnose, focusOrder, BENCHMARKS, AUDIENCE_FIT, CHANNEL_MECHANICS };
