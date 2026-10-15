import { Youtube, Linkedin, Image, Info } from 'lucide-react'
import { formatCompact } from '../utils/format'

const ICONS = { youtube: Youtube, linkedin: Linkedin, pinterest: Image }
const COLORS = { youtube: '#FF3B4E', linkedin: '#0A66C2', pinterest: '#E60023' }

export default function ChannelHeader({ channel, notice, platform = 'youtube' }) {
  if (!channel) return null
  const Icon = ICONS[platform] || Youtube

  return (
    <div className="panel p-5 flex flex-wrap items-center gap-5">
      <div className="w-14 h-14 rounded-full bg-surface2 border border-hairline2 overflow-hidden flex items-center justify-center shrink-0">
        {channel.thumbnail ? (
          <img src={channel.thumbnail} alt={channel.name} className="w-full h-full object-cover" />
        ) : (
          <Icon className="w-6 h-6" style={{ color: COLORS[platform] || '#FF3B4E' }} strokeWidth={2} />
        )}
      </div>
      <div className="flex-1 min-w-[160px]">
        <p className="font-display text-lg font-semibold text-text">{channel.name}</p>
        {channel.handle && <p className="text-xs text-text-muted font-mono">{channel.handle}</p>}
      </div>
      <div className="flex items-center gap-6">
        {channel.lifetime?.subscribers != null && <Stat label="Subscribers" value={channel.lifetime.subscribers} />}
        {channel.lifetime?.totalViews != null && <Stat label="Total views" value={channel.lifetime.totalViews} />}
        {channel.lifetime?.totalVideos != null && <Stat label="Videos" value={channel.lifetime.totalVideos} />}
      </div>
      {notice && (
        <div className="w-full flex items-start gap-2 mt-1 pt-3 border-t border-hairline text-[11px] text-amber/90 font-mono">
          <Info className="w-3.5 h-3.5 shrink-0 mt-0.5" />{notice}
        </div>
      )}
    </div>
  )
}

function Stat({ label, value }) {
  return (
    <div className="text-right">
      <p className="font-mono text-lg font-medium text-text tabular-nums">{formatCompact(value)}</p>
      <p className="text-[10px] text-text-faint font-mono uppercase tracking-wide">{label}</p>
    </div>
  )
}
