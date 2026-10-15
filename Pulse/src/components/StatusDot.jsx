export default function StatusDot({ status, size = 7 }) {
  const color = status === 'ok' ? 'bg-good' : status === 'unknown' ? 'bg-text-faint' : 'bg-bad'
  const glow = status === 'ok' ? 'shadow-[0_0_8px_rgba(62,213,152,0.7)]' : status === 'unknown' ? '' : 'shadow-[0_0_8px_rgba(255,122,89,0.7)]'
  return (
    <span
      className={`inline-block rounded-full ${color} ${glow} ${status === 'ok' ? 'animate-blink' : ''}`}
      style={{ width: size, height: size }}
    />
  )
}
