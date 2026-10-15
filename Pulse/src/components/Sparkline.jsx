import { AreaChart, Area, ResponsiveContainer, YAxis } from 'recharts'

export default function Sparkline({ data, color = '#F2A93B', height = 40 }) {
  if (!data || data.length < 2) {
    return <div style={{ height }} className="flex items-center text-[10px] text-text-faint font-mono">no data</div>
  }
  const id = `spark-${color.replace('#', '')}`
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
        <defs>
          <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.35} />
            <stop offset="100%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
        <YAxis hide domain={['dataMin', 'dataMax']} />
        <Area
          type="monotone"
          dataKey="value"
          stroke={color}
          strokeWidth={1.75}
          fill={`url(#${id})`}
          isAnimationActive={false}
        />
      </AreaChart>
    </ResponsiveContainer>
  )
}
