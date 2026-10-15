import { ArrowUpRight, ArrowDownRight, Minus } from 'lucide-react'
import Sparkline from './Sparkline'
import { formatCompact, formatTrend } from '../utils/format'

export default function MetricCard({ metric, color, selected, onClick }) {
  const trend = metric.summary?.trend ?? 0
  const dir = trend > 0 ? 'up' : trend < 0 ? 'down' : 'flat'
  const sparkData = metric.values?.map((v) => ({ date: v.date, value: v.value })) || []

  return (
    <button
      onClick={onClick}
      className={`text-left panel p-4 flex flex-col gap-3 transition-all hover:border-hairline2 ${
        selected ? 'ring-1 ring-amber/50 border-amber/40' : ''
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs text-text-muted leading-snug">{metric.label}</p>
        <div
          className={`flex items-center gap-0.5 text-[11px] font-mono shrink-0 ${
            dir === 'up' ? 'text-good' : dir === 'down' ? 'text-bad' : 'text-text-faint'
          }`}
        >
          {dir === 'up' && <ArrowUpRight className="w-3 h-3" />}
          {dir === 'down' && <ArrowDownRight className="w-3 h-3" />}
          {dir === 'flat' && <Minus className="w-3 h-3" />}
          {formatTrend(trend)}
        </div>
      </div>
      <p className="font-display text-2xl font-semibold text-text tabular-nums">
        {formatCompact(metric.summary?.total ?? metric.summary?.latest)}
      </p>
      <Sparkline data={sparkData} color={color} height={32} />
    </button>
  )
}
