import { Globe2, Users, ArrowRight, Lock } from 'lucide-react'
import { Card, CardHeader, CardBody } from '../ui/Card'
import { flagOf, nameOf, codeOf } from '../../lib/countries'
import { percent, compact } from '../../lib/format'

/**
 * DemographicsStrip — the platform page's own audience summary.
 *
 * Only renders what this platform genuinely reports: a country list, a gender
 * bar, the strongest age bucket and (where available) devices. Platforms whose
 * upstream has no demographics get a one-line locked explanation instead of a
 * fabricated chart.
 */
export default function DemographicsStrip({ demo, color = '#2F6BFF', onOpen }) {
  if (!demo) return null

  if (!demo.available) {
    return (
      <Card>
        <CardHeader
          title="Audience composition"
          icon={<Lock className="w-4 h-4" strokeWidth={2} />}
          right={onOpen ? <button className="btn btn-ghost btn-sm" onClick={onOpen}>Audience page <ArrowRight className="w-3.5 h-3.5" /></button> : null}
        />
        <CardBody className="py-4">
          <p className="text-[12.5px] leading-relaxed text-muted">{demo.note || 'This platform does not publish audience demographics.'}</p>
        </CardBody>
      </Card>
    )
  }

  const countries = (demo.countries || []).slice(0, 6)
  const topAge = demo.age?.slice().sort((a, b) => b.total - a.total)[0]
  const fmt = demo.unit === 'share' ? (v) => percent(v) : (v) => compact(v)

  return (
    <Card>
      <CardHeader
        title="Audience composition"
        sub={demo.source}
        icon={<Users className="w-4 h-4" strokeWidth={2} />}
        right={onOpen ? <button className="btn btn-ghost btn-sm" onClick={onOpen}>Full audience view <ArrowRight className="w-3.5 h-3.5" /></button> : null}
      />
      <CardBody>
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1.2fr_1fr_1fr]">
          <div>
            <p className="eyebrow mb-2">Top countries</p>
            {countries.length ? (
              <ul className="flex flex-col gap-1.5">
                {countries.map((c) => {
                  const code = codeOf(c.code || c.name)
                  return (
                    <li key={code || c.name} className="flex items-center gap-2">
                      <span className="text-[14px] leading-none">{flagOf(code)}</span>
                      <span className="flex-1 truncate text-[12.5px] text-body">{nameOf(c.code || c.name)}</span>
                      <div className="h-1.5 w-20 overflow-hidden rounded-full bg-line">
                        <div className="h-full rounded-full" style={{ width: `${Math.min(100, c.share || 0)}%`, background: color }} />
                      </div>
                      <span className="num w-12 text-right text-[11.5px] text-muted">{fmt(c.value)}</span>
                    </li>
                  )
                })}
              </ul>
            ) : (
              <p className="text-[12px] text-faint">Not reported by this platform.</p>
            )}
          </div>

          <div className="flex flex-col gap-4">
            <div>
              <p className="eyebrow mb-2">Gender</p>
              {demo.gender ? (
                <>
                  <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-line">
                    <div style={{ width: `${demo.gender.male}%`, background: '#2F6BFF' }} />
                    <div style={{ width: `${demo.gender.female}%`, background: '#E1306C' }} />
                    <div style={{ width: `${demo.gender.unknown}%`, background: '#94A1B4' }} />
                  </div>
                  <p className="mt-1.5 text-[11.5px] text-muted">
                    {percent(demo.gender.male)} male · {percent(demo.gender.female)} female
                    {demo.gender.unknown > 1 ? ` · ${percent(demo.gender.unknown)} undeclared` : ''}
                  </p>
                </>
              ) : (
                <p className="text-[12px] text-faint">Not reported by this platform.</p>
              )}
            </div>
            <div>
              <p className="eyebrow mb-1">Strongest age group</p>
              {topAge ? (
                <>
                  <p className="num text-[22px] font-semibold text-ink">{topAge.bucket}</p>
                  <p className="text-[11.5px] text-faint">{fmt(topAge.total)} in this bucket</p>
                </>
              ) : (
                <p className="text-[12px] text-faint">Not reported by this platform.</p>
              )}
            </div>
          </div>

          <div>
            <p className="eyebrow mb-2">{demo.devices?.length ? 'Devices' : demo.cities?.length ? 'Top cities' : 'About this data'}</p>
            {demo.devices?.length ? (
              <ul className="flex flex-col gap-1.5">
                {demo.devices.slice(0, 4).map((d) => (
                  <li key={d.label} className="flex items-center gap-2">
                    <span className="flex-1 truncate text-[12.5px] text-body">{d.label}</span>
                    <div className="h-1.5 w-20 overflow-hidden rounded-full bg-line">
                      <div className="h-full rounded-full" style={{ width: `${Math.min(100, d.share || 0)}%`, background: '#6B7A90' }} />
                    </div>
                    <span className="num w-12 text-right text-[11.5px] text-muted">{fmt(d.value)}</span>
                  </li>
                ))}
              </ul>
            ) : demo.cities?.length ? (
              <ul className="flex flex-col gap-1.5">
                {demo.cities.slice(0, 5).map((c) => (
                  <li key={c.name} className="flex items-center gap-2">
                    <span className="flex-1 truncate text-[12.5px] text-body">{c.name}</span>
                    <span className="num text-[11.5px] text-muted">{fmt(c.value)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-[12px] leading-relaxed text-faint">{demo.note || 'Nothing else to show for this platform.'}</p>
            )}
            <p className="mt-3 flex items-start gap-1.5 text-[11px] leading-relaxed text-faint">
              <Globe2 className="mt-0.5 w-3 h-3 shrink-0" />
              {demo.unit === 'share' ? 'Shares of viewers, not head-counts.' : 'Counts of current followers, not reach in this range.'}
            </p>
          </div>
        </div>
      </CardBody>
    </Card>
  )
}
