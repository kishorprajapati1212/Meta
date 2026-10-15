import { LayoutGrid, ExternalLink } from 'lucide-react'
import BarList from '../charts/BarList'
import { Card, CardHeader, CardBody } from '../ui/Card'
import { EmptyState } from '../ui/States'
import { compact } from '../../lib/format'

/**
 * BoardList — Pinterest boards from GET /v1/accounts/{id}/pinterest-boards.
 * Falls back to the account-level board count when Zernio does not expose the
 * board list (older plans), and says so instead of rendering an empty panel.
 */
export default function BoardList({ boards = [], account = null, color = '#E60023' }) {
  const items = (boards || []).map((b, i) => ({
    id: b.id || b.name || i,
    label: b.name,
    value: b.pinCount || 0,
    href: b.url || null,
    rank: i + 1,
    footnote: b.privacy && b.privacy !== 'PUBLIC' ? b.privacy.toLowerCase() : null,
  }))

  if (!items.length) {
    return (
      <Card>
        <CardHeader
          title="Boards"
          sub={account?.boardCount ? `${account.boardCount} boards on the account` : 'Boards published to'}
          icon={<LayoutGrid className="w-4 h-4" strokeWidth={2} />}
        />
        <CardBody>
          <EmptyState
            title="Board list unavailable"
            message={
              account?.boardCount
                ? `Zernio reports ${account.boardCount} boards but did not return their names or pin counts. The count is still shown in the metric grid above.`
                : 'Zernio did not return any boards for this account. Boards appear once a pin has been published to one, or once the boards:read scope is granted.'
            }
          />
        </CardBody>
      </Card>
    )
  }

  const totalPins = items.reduce((s, i) => s + i.value, 0)

  return (
    <Card>
      <CardHeader
        title="Boards"
        sub={`${items.length} boards · ${compact(totalPins)} pins across them`}
        icon={<LayoutGrid className="w-4 h-4" strokeWidth={2} />}
        right={
          account?.link ? (
            <a href={account.link} target="_blank" rel="noopener noreferrer" className="btn-ghost text-[12px]">
              Open profile <ExternalLink className="w-3 h-3" strokeWidth={2} />
            </a>
          ) : null
        }
      />
      <CardBody>
        <BarList
          items={items}
          color={color}
          format={compact}
          showShare
          emptyMessage="No boards with pins in this range."
        />
      </CardBody>
    </Card>
  )
}
