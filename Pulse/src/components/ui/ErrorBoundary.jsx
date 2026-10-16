import { Component } from 'react'
import { AlertTriangle } from 'lucide-react'

/**
 * ErrorBoundary — the last line of defence against a white screen.
 *
 * A dashboard that reads six third-party APIs will eventually receive a shape
 * nobody anticipated. Without a boundary, one bad field unmounts the entire
 * tree and the user sees a blank page with only a console error. With it, the
 * broken panel is replaced by an honest card that keeps the rest of the
 * dashboard usable and offers a retry.
 */
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    // eslint-disable-next-line no-console
    console.error('[pulse] panel crashed:', error, info?.componentStack)
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <div className="card p-6 flex flex-col items-center gap-3 text-center">
        <span className="w-11 h-11 rounded-full bg-neg-soft border border-neg-line flex items-center justify-center text-neg">
          <AlertTriangle className="w-5 h-5" strokeWidth={1.9} />
        </span>
        <div>
          <p className="font-display text-[15px] font-bold text-ink">This panel hit unexpected data</p>
          <p className="text-[13px] text-muted mt-1.5 max-w-md leading-relaxed">
            The API answered with a shape this view does not recognise yet. The rest of the dashboard is unaffected.
            Retrying usually resolves it after the next successful refresh.
          </p>
          <p className="mt-2 text-[11px] text-faint font-mono break-words max-w-md">
            {String(this.state.error?.message || this.state.error)}
          </p>
        </div>
        <div className="flex gap-2">
          <button
            className="btn-primary"
            onClick={() => {
              this.setState({ error: null })
              this.props.onRetry?.()
            }}
          >
            Retry
          </button>
          <button className="btn" onClick={() => this.setState({ error: null })}>
            Dismiss
          </button>
        </div>
      </div>
    )
  }
}
