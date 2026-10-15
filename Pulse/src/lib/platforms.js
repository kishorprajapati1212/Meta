/**
 * platforms.js — the platform registry.
 * One place that knows every platform's identity, brand colour, API source and
 * the order its metrics should be displayed in.
 */

export const PLATFORM_ORDER = [
  'facebook',
  'instagram',
  'youtube',
  'linkedin',
  'pinterest',
  'searchConsole',
]

export const PLATFORMS = {
  facebook: {
    key: 'facebook',
    label: 'Facebook',
    short: 'FB',
    color: '#1877F2',
    tint: '#EAF2FE',
    source: 'Meta Graph API',
    endpoint: '/api/facebook',
    kind: 'meta',
    blurb: 'Page reach, views, follows and post engagement.',
  },
  instagram: {
    key: 'instagram',
    label: 'Instagram',
    short: 'IG',
    color: '#E1306C',
    tint: '#FDEEF4',
    source: 'Meta Graph API',
    endpoint: '/api/instagram',
    kind: 'meta',
    blurb: 'Reach, profile visits, interactions and follower growth.',
  },
  youtube: {
    key: 'youtube',
    label: 'YouTube',
    short: 'YT',
    color: '#FF0033',
    tint: '#FFECEF',
    source: 'YouTube Analytics API',
    endpoint: '/api/youtube',
    kind: 'google',
    blurb: 'Views, watch time, retention and subscriber movement.',
  },
  linkedin: {
    key: 'linkedin',
    label: 'LinkedIn',
    short: 'LI',
    color: '#0A66C2',
    tint: '#E9F1FB',
    source: 'Zernio',
    endpoint: '/api/linkedin',
    kind: 'zernio',
    blurb: 'Impressions, reactions, comments and follower growth.',
  },
  pinterest: {
    key: 'pinterest',
    label: 'Pinterest',
    short: 'PI',
    color: '#E60023',
    tint: '#FDEBEE',
    source: 'Zernio',
    endpoint: '/api/pinterest',
    kind: 'zernio',
    blurb: 'Pin impressions, clicks, saves, boards and monthly views.',
  },
  searchConsole: {
    key: 'searchConsole',
    label: 'Search Console',
    short: 'GSC',
    color: '#2FA84F',
    tint: '#EAF7EE',
    source: 'Google Search Console API',
    endpoint: '/api/gsc',
    kind: 'google',
    blurb: 'Organic clicks, impressions, CTR and average position.',
  },
}

export const ZERNIO_PLATFORMS = ['linkedin', 'pinterest']
export const META_PLATFORMS = ['facebook', 'instagram']

/** Human labels for overview keys, used when an older API omits `label`. */
export const KEY_LABELS = {
  followers: 'Followers',
  newFollows: 'New follows',
  unfollows: 'Unfollows',
  netFollows: 'Net follows',
  pageViews: 'Page views',
  contentViews: 'Media views',
  uniqueViewers: 'Unique viewers',
  engagement: 'Engagement',
  engagementRate: 'Engagement rate',
  interactions: 'Interactions',
  reach: 'Reach',
  impressions: 'Impressions',
  profileVisits: 'Profile visits',
  websiteClicks: 'Website clicks',
  views: 'Views',
  watchTime: 'Watch time',
  watchTimeHours: 'Watch time (hours)',
  avgViewDuration: 'Avg view duration',
  avgViewPercentage: 'Avg view %',
  subsGained: 'Subscribers gained',
  subsLost: 'Subscribers lost',
  netSubscribers: 'Net subscribers',
  likes: 'Likes',
  dislikes: 'Dislikes',
  comments: 'Comments',
  shares: 'Shares',
  saves: 'Saves',
  sends: 'Sends',
  follows: 'Follows',
  clicks: 'Clicks',
  outboundClicks: 'Outbound clicks',
  closeups: 'Closeups',
  ctr: 'CTR',
  position: 'Avg position',
  posts: 'Posts',
  pins: 'Total pins',
  boards: 'Boards',
  monthlyViews: 'Monthly views',
  uniqueItems: 'Rows returned',
  externalPosts: 'External posts',
}

/** Display order for KPI cards. Unknown keys are appended after these. */
export const METRIC_ORDER = {
  facebook: [
    'followers', 'newFollows', 'unfollows', 'netFollows', 'pageViews', 'reach',
    'impressions', 'contentViews', 'uniqueViewers', 'engagement', 'engagementRate',
    'likes', 'comments', 'shares', 'videoViews',
  ],
  instagram: [
    'followers', 'reach', 'impressions', 'profileVisits', 'interactions',
    'engagementRate', 'likes', 'comments', 'shares', 'saves', 'websiteClicks',
  ],
  youtube: [
    'followers', 'views', 'watchTime', 'watchTimeHours', 'avgViewDuration',
    'avgViewPercentage', 'netSubscribers', 'subsGained', 'subsLost',
    'engagementRate', 'likes', 'dislikes', 'comments', 'shares',
  ],
  linkedin: [
    'followers', 'impressions', 'reach', 'clicks', 'engagement', 'engagementRate',
    'likes', 'comments', 'shares', 'saves', 'sends', 'follows', 'posts',
  ],
  pinterest: [
    'followers', 'pins', 'boards', 'monthlyViews', 'impressions', 'clicks',
    'outboundClicks', 'saves', 'closeups', 'views', 'engagement', 'engagementRate', 'posts',
  ],
  searchConsole: ['clicks', 'impressions', 'ctr', 'position'],
}

/** Backend metric id → overview key, so nothing is rendered twice. */
export const ID_TO_KEY = {
  follower_count: 'followers',
  page_fans: 'followers',
  page_follows: 'newFollows',
  page_daily_follows: 'newFollows',
  page_daily_unfollows_unique: 'unfollows',
  page_views_total: 'pageViews',
  page_media_view: 'contentViews',
  page_total_media_view_unique: 'uniqueViewers',
  page_post_engagements: 'engagement',
  page_impressions: 'impressions',
  page_impressions_unique: 'reach',
  page_video_views: 'videoViews',
  reach: 'reach',
  impressions: 'impressions',
  profile_views: 'profileVisits',
  total_interactions: 'interactions',
  website_clicks: 'websiteClicks',
  views: 'views',
  estimatedMinutesWatched: 'watchTime',
  averageViewDuration: 'avgViewDuration',
  averageViewPercentage: 'avgViewPercentage',
  subscribersGained: 'subsGained',
  subscribersLost: 'subsLost',
  likes: 'likes',
  dislikes: 'dislikes',
  comments: 'comments',
  shares: 'shares',
  saves: 'saves',
  clicks: 'clicks',
  ctr: 'ctr',
  position: 'position',
  engagementRate: 'engagementRate',
  outboundClicks: 'outboundClicks',
  posts: 'posts',
  pins: 'pins',
  boards: 'boards',
  monthlyViews: 'monthlyViews',
  followers: 'followers',
}

/** Which timeseries column feeds a metric's sparkline. */
export const SERIES_KEY = {
  followers: ['followers', 'follower_count', 'page_fans'],
  newFollows: ['page_daily_follows', 'page_follows'],
  unfollows: ['page_daily_unfollows_unique'],
  pageViews: ['page_views_total'],
  contentViews: ['page_media_view'],
  uniqueViewers: ['page_total_media_view_unique'],
  engagement: ['page_post_engagements', 'engagement'],
  interactions: ['total_interactions'],
  reach: ['reach', 'page_impressions_unique'],
  impressions: ['impressions', 'page_impressions'],
  profileVisits: ['profile_views'],
  views: ['views'],
  watchTime: ['estimatedMinutesWatched'],
  watchTimeHours: ['estimatedMinutesWatched'],
  avgViewDuration: ['averageViewDuration'],
  avgViewPercentage: ['averageViewPercentage'],
  subsGained: ['subscribersGained'],
  subsLost: ['subscribersLost'],
  netSubscribers: ['subscribersGained'],
  likes: ['likes'],
  dislikes: ['dislikes'],
  comments: ['comments'],
  shares: ['shares'],
  saves: ['saves'],
  sends: ['sends'],
  follows: ['follows'],
  clicks: ['clicks'],
  outboundClicks: ['outboundClicks'],
  closeups: ['closeups'],
  ctr: ['ctr'],
  position: ['position'],
  engagementRate: ['engagementRate'],
  posts: ['posts', 'postCount'],
}

/** Headline KPIs for the Overview page, in display order. */
export const OVERVIEW_KPIS = [
  { key: 'audience', label: 'Total audience', sub: 'Followers + subscribers across channels' },
  { key: 'impressions', label: 'Impressions / reach', sub: 'Highest of impressions or reach per channel' },
  { key: 'engagement', label: 'Engagement', sub: 'Likes, comments, shares, saves and clicks' },
  { key: 'posts', label: 'Content published', sub: 'Posts and pins in the selected range' },
  { key: 'searchClicks', label: 'Search clicks', sub: 'Google Search Console' },
  { key: 'engagementRate', label: 'Engagement rate', sub: 'Engagement ÷ impressions' },
]

export const DATE_PRESETS = [
  { key: 'last_7d', label: '7 days', days: 7 },
  { key: 'last_14d', label: '14 days', days: 14 },
  { key: 'last_30d', label: '30 days', days: 30 },
  { key: 'last_90d', label: '90 days', days: 90 },
  { key: 'last_365d', label: '12 months', days: 365 },
]

export function platformMeta(key) {
  return PLATFORMS[key] || { key, label: key, short: key, color: '#6B7A90', tint: '#F1F3F7', source: '—' }
}
