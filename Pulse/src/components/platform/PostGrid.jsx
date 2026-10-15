import { useMemo, useState } from 'react'
import { ExternalLink, Image as ImageIcon, Video, Type, Bookmark, MousePointerClick, Eye, Heart, MessageCircle, Repeat2, Link2 } from 'lucide-react'
import { cls } from '../../lib/cls'
import BrandIcon from '../ui/BrandIcon'
import Segmented from '../ui/Segmented'
import { Pill, Tag } from '../ui/Pill'
import { compact, dateLong, relativeTime, truncate } from '../../lib/format'
import { platformMeta } from '../../lib/platforms'

const SORTS = [
  { value: 'engagement', label: 'Top engagement' },
  { value: 'impressions', label: 'Most impressions' },
  { value: 'recent', label: 'Most recent' },
]

/**
 * PostGrid — every post/pin the API returned, with its full analytics row.
 * Media type, board, external/synced state and each non-zero metric are shown,
 * so a pin with 12.4K impressions and 88 saves reads as such at a glance.
 */
export default function PostGrid({
  posts = [],
  platformKey,
  title = 'Content',
  subtitle,
  limit = 24,
  className = '',
}) {
  const [sort, setSort] = useState('engagement')
  const meta = platformMeta(platformKey)

  const sorted = useMemo(() => {
    const list = [...posts]
    if (sort === 'engagement') list.sort((a, b) => (b.analytics?.engagement || 0) - (a.analytics?.engagement || 0))
    if (sort === 'impressions') list.sort((a, b) => (b.analytics?.impressions || 0) - (a.analytics?.impressions || 0))
    if (sort === 'recent') list.sort((a, b) => String(b.publishedAt || '').localeCompare(String(a.publishedAt || '')))
    return list.slice(0, limit)
  }, [posts, sort, limit])

  if (!posts.length) return null

  return (
    <section className={cls('card overflow-hidden', className)}>
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5 border-b border-line">
        <div>
          <h3 className="section-title">{title}</h3>
          <p className="section-sub mt-0.5">
            {subtitle || `${posts.length} ${platformKey === 'pinterest' ? 'pin' : 'post'}${posts.length === 1 ? '' : 's'} returned by the API in this range`}
          </p>
        </div>
        <Segmented options={SORTS} value={sort} onChange={setSort} size="sm" ariaLabel="Sort content" />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3 p-4">
        {sorted.map((post, i) => (
          <PostCard key={post.postId || post.platformUrl || i} post={post} color={meta.color} platformKey={platformKey} />
        ))}
      </div>

      {posts.length > sorted.length ? (
        <p className="px-5 py-3 border-t border-line text-[12px] text-faint num">
          Showing {sorted.length} of {posts.length} — narrow the date range or use the platform endpoint for the full list.
        </p>
      ) : null}
    </section>
  )
}

function PostCard({ post, color, platformKey }) {
  const a = post.analytics || {}
  const isPin = platformKey === 'pinterest'
  const MediaIcon = post.mediaType === 'video' ? Video : post.mediaType === 'image' ? ImageIcon : Type

  const stats = [
    { icon: Eye, label: isPin ? 'Impressions' : 'Impressions', value: a.impressions },
    { icon: MousePointerClick, label: isPin ? 'Pin clicks' : 'Clicks', value: a.clicks },
    { icon: Bookmark, label: 'Saves', value: a.saves },
    { icon: Heart, label: isPin ? 'Reactions' : 'Likes', value: a.likes },
    { icon: MessageCircle, label: 'Comments', value: a.comments },
    { icon: Repeat2, label: isPin ? 'Shares' : 'Reposts', value: a.shares },
    { icon: Link2, label: 'Outbound', value: a.outboundClicks },
    { icon: Video, label: 'Views', value: a.views },
  ].filter((s) => s.value > 0)

  return (
    <article className="rounded-xl border border-line bg-surface overflow-hidden flex flex-col card-hover">
      <div className="relative h-28 bg-sunken border-b border-line flex items-center justify-center overflow-hidden">
        {post.thumbnail ? (
          <img src={post.thumbnail} alt="" className="w-full h-full object-cover" loading="lazy" />
        ) : (
          <div
            className="w-full h-full flex flex-col items-center justify-center gap-1.5"
            style={{ background: `linear-gradient(135deg, ${color}14, ${color}05)` }}
          >
            <MediaIcon className="w-5 h-5" style={{ color }} strokeWidth={1.8} />
            <span className="text-[10.5px] uppercase tracking-[0.08em] font-semibold text-faint">
              {post.mediaType || 'media'}
            </span>
          </div>
        )}
        <span className="absolute top-2 left-2">
          <BrandIcon platform={platformKey} className="w-3.5 h-3.5 text-white drop-shadow" />
        </span>
        <span className="absolute top-2 right-2 flex items-center gap-1">
          {post.isExternal ? <Pill tone="neutral" className="bg-surface/90 backdrop-blur text-[10px] py-0.5">External</Pill> : null}
          {post.mediaType === 'video' ? <Pill tone="brand" className="bg-surface/90 backdrop-blur text-[10px] py-0.5">Video</Pill> : null}
        </span>
      </div>

      <div className="p-3.5 flex flex-col gap-2.5 flex-1">
        <p className="text-[13px] text-ink leading-snug line-clamp-3" title={post.content}>
          {post.title ? <span className="font-semibold">{post.title}</span> : null}
          {post.title && post.content && post.title !== post.content ? <span className="text-muted"> — {truncate(post.content, 110)}</span> : null}
          {!post.title ? truncate(post.content, 150) : null}
        </p>

        <div className="flex flex-wrap items-center gap-1.5">
          {post.boardName ? <Tag>{post.boardName}</Tag> : null}
          {a.engagementRate > 0 ? <Tag color={color}>{a.engagementRate}% ER</Tag> : null}
          <span className="text-[11px] text-faint num ml-auto" title={post.publishedAt || ''}>
            {post.publishedAt ? dateLong(post.publishedAt) : 'unscheduled'}
          </span>
        </div>

        <div className="mt-auto pt-2.5 border-t border-line/70">
          {stats.length ? (
            <div className="grid grid-cols-3 gap-x-2 gap-y-1.5">
              {stats.slice(0, 6).map((s) => (
                <div key={s.label} className="min-w-0">
                  <p className="flex items-center gap-1 text-[10px] text-faint uppercase tracking-[0.04em] font-semibold truncate">
                    <s.icon className="w-2.5 h-2.5 shrink-0" strokeWidth={2.2} />
                    {s.label}
                  </p>
                  <p className="text-[13px] font-semibold text-ink num">{compact(s.value)}</p>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-[11.5px] text-faint leading-relaxed">
              No metrics synced for this {isPin ? 'pin' : 'post'} yet —
              {isPin
                ? ' Pinterest reports impressions with a 24–48h delay and only for pins Zernio can read.'
                : ' LinkedIn returns analytics only for posts published through Zernio on personal profiles.'}
            </p>
          )}
        </div>

        {post.url ? (
          <a
            href={post.url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-[12px] font-medium text-brand-ink hover:underline"
          >
            Open on {platformMeta(platformKey).label} <ExternalLink className="w-3 h-3" strokeWidth={2} />
          </a>
        ) : null}
      </div>
    </article>
  )
}
