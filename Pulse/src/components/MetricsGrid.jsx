import MetricCard from './MetricCard'

export default function MetricsGrid({ metrics, color, selectedId, onSelect }) {
  if (!metrics || metrics.length === 0) return null
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
      {metrics.map((m) => (
        <MetricCard
          key={m.id}
          metric={m}
          color={color}
          selected={selectedId === m.id}
          onClick={() => onSelect(m.id)}
        />
      ))}
    </div>
  )
}
