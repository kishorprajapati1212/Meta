import { useMemo, useState } from 'react'
import { ArrowUpDown, ArrowDown, ArrowUp, Download, Inbox } from 'lucide-react'
import { cls } from '../../lib/cls'
import { exportCSV } from '../../lib/csv'

/**
 * DataTable — sortable, scrollable table with CSV export.
 *
 * columns: [{ key, label, align?, width?, render?(row), sortValue?(row), csvValue?(row) }]
 */
export default function DataTable({
  rows,
  columns,
  initialSort = null,
  exportName = 'export',
  emptyMessage = 'Nothing to show for this range.',
  maxHeight = 420,
  dense = false,
  onRowClick,
  footer = null,
  className = '',
  zebra = true,
}) {
  const [sort, setSort] = useState(initialSort)

  const sorted = useMemo(() => {
    if (!sort) return rows
    const col = columns.find((c) => c.key === sort.key)
    const get = (r) => (col?.sortValue ? col.sortValue(r) : r[sort.key])
    return [...rows].sort((a, b) => {
      const va = get(a)
      const vb = get(b)
      if (va === vb) return 0
      if (va === null || va === undefined) return 1
      if (vb === null || vb === undefined) return -1
      const cmp = typeof va === 'string' ? va.localeCompare(vb) : va - vb
      return sort.dir === 'asc' ? cmp : -cmp
    })
  }, [rows, columns, sort])

  function toggle(key) {
    setSort((s) => (s?.key === key ? { key, dir: s.dir === 'desc' ? 'asc' : 'desc' } : { key, dir: 'desc' }))
  }

  function doExport() {
    const cols = columns.map((c) => ({
      label: c.label,
      value: (r) => (c.csvValue ? c.csvValue(r) : c.sortValue ? c.sortValue(r) : r[c.key]),
    }))
    exportCSV(exportName, sorted, cols)
  }

  const cellPad = dense ? 'py-1.5' : 'py-2.5'

  if (!rows.length) {
    return (
      <div className={cls('card', className)}>
        <div className="flex flex-col items-center justify-center gap-2 py-12 text-center">
          <Inbox className="w-5 h-5 text-faint" strokeWidth={1.8} />
          <p className="text-[13px] text-muted">{emptyMessage}</p>
        </div>
      </div>
    )
  }

  return (
    <div className={cls('card overflow-hidden', className)}>
      <div className="flex items-center justify-between gap-3 px-4 py-2.5 border-b border-line bg-sunken/60">
        <p className="text-[11.5px] font-medium text-muted num">
          {sorted.length.toLocaleString('en-US')} row{sorted.length === 1 ? '' : 's'}
        </p>
        <button className="btn-ghost text-[12px]" onClick={doExport} title="Download as CSV">
          <Download className="w-3.5 h-3.5" strokeWidth={2} />
          CSV
        </button>
      </div>
      <div className="overflow-auto" style={{ maxHeight }}>
        <table className="w-full border-collapse">
          <thead className="sticky top-0 z-10 bg-surface shadow-[0_1px_0_0_#E7EAF0]">
            <tr>
              {columns.map((c) => {
                const active = sort?.key === c.key
                return (
                  <th
                    key={c.key}
                    className={cls(
                      'th whitespace-nowrap select-none',
                      c.align === 'right' && 'text-right',
                      c.align === 'center' && 'text-center',
                      c.width && `w-[${c.width}]`
                    )}
                    style={c.width ? { width: c.width } : undefined}
                  >
                    <button
                      onClick={() => toggle(c.key)}
                      className={cls(
                        'inline-flex items-center gap-1 hover:text-ink transition-colors',
                        c.align === 'right' && 'flex-row-reverse',
                        active && 'text-ink'
                      )}
                    >
                      {c.label}
                      {active ? (
                        sort.dir === 'desc' ? (
                          <ArrowDown className="w-3 h-3" strokeWidth={2.5} />
                        ) : (
                          <ArrowUp className="w-3 h-3" strokeWidth={2.5} />
                        )
                      ) : (
                        <ArrowUpDown className="w-3 h-3 opacity-35" strokeWidth={2} />
                      )}
                    </button>
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody>
            {sorted.map((row, i) => (
              <tr
                key={row.id ?? row.date ?? i}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                className={cls(
                  'border-t border-line/70 transition-colors',
                  zebra && i % 2 === 1 && 'bg-sunken/50',
                  onRowClick && 'cursor-pointer hover:bg-brand-soft/40'
                )}
              >
                {columns.map((c) => (
                  <td
                    key={c.key}
                    className={cls(
                      'td',
                      cellPad,
                      c.align === 'right' && 'text-right num',
                      c.align === 'center' && 'text-center',
                      c.className
                    )}
                  >
                    {c.render ? c.render(row, i) : row[c.key]}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
          {footer ? <tfoot className="sticky bottom-0 bg-surface shadow-[0_-1px_0_0_#E7EAF0]">{footer}</tfoot> : null}
        </table>
      </div>
    </div>
  )
}
