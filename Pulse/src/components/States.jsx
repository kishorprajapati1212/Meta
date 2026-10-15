import { AlertTriangle, RadioTower, Inbox } from 'lucide-react'

export function LoadingState() {
  return (
    <div className="flex flex-col items-center justify-center py-32 gap-4">
      <div className="relative w-14 h-14">
        <div className="absolute inset-0 rounded-full border-2 border-hairline2" />
        <div className="absolute inset-0 rounded-full border-2 border-amber border-t-transparent animate-spin" />
        <RadioTower className="absolute inset-0 m-auto w-5 h-5 text-amber" strokeWidth={2} />
      </div>
      <p className="eyebrow">acquiring signal…</p>
    </div>
  )
}

export function ErrorState({ message, onRetry }) {
  return (
    <div className="flex flex-col items-center justify-center py-32 gap-4 text-center px-6">
      <AlertTriangle className="w-8 h-8 text-bad" strokeWidth={1.75} />
      <div>
        <p className="text-text font-display text-lg mb-1">Signal lost</p>
        <p className="text-sm text-text-muted font-mono max-w-md">{message}</p>
      </div>
      {onRetry && (
        <button
          onClick={onRetry}
          className="mt-1 px-4 py-2 rounded-lg bg-surface2 border border-hairline2 text-sm text-text hover:border-amber/50 transition-colors"
        >
          Retry connection
        </button>
      )}
    </div>
  )
}

export function EmptyState({ message = 'Nothing here yet.' }) {
  return (
    <div className="flex flex-col items-center justify-center py-20 gap-3 text-center">
      <Inbox className="w-6 h-6 text-text-faint" strokeWidth={1.75} />
      <p className="text-sm text-text-faint font-mono">{message}</p>
    </div>
  )
}
