import { useMemo, useState } from 'react'
import { Globe2, Users, Lock, MapPin, MonitorSmartphone, Cake, Info } from 'lucide-react'
import { Panel as Card } from '../ui/Card'
import { Pill } from '../ui/Pill'
import Segmented from '../ui/Segmented'
import { EmptyState, NoticeBar } from '../ui/States'
import WorldMap from '../charts/WorldMap'
import Donut from '../charts/Donut'
import BarList from '../charts/BarList'
import PageHeader from '../platform/PageHeader'
import { PLATFORM_ORDER, PLATFORMS } from '../../lib/platforms'
import { isErrorPayload } from '../../lib/normalize'
import { codeOf, nameOf, flagOf } from '../../lib/countries'
import { compact, percent } from '../../lib/format'
import { cls } from '../../lib/cls'

/**
 * AudiencePage — who the audience is, using only what each platform genuinely
 * reports. Nothing here is invented: YouTube contributes viewer shares,
 * Instagram/Facebook follower counts, Search Console clicks by country and
 * device, and LinkedIn/Pinterest honestly report "not available" because the
 * Zernio API exposes no demographics at all.
 */

const DIMENSIONS = [
  { key: 'age', label: 'Age', icon: Cake },
  { key: 'gender', label: 'Gender', icon: Users },
  { key: 'countries', label: 'Countries', icon: Globe2 },
  { key: 'cities', label: 'Cities', icon: MapPin },
  { key: 'devices', label: 'Devices', icon: MonitorSmartphone },
]

function demographicsOf(platformData, key) {
  const p = platformData?.[key]
  if (!p || isErrorPayload(p)) return null
  return p.demographics || null
}

function countryRows(demo) {
  if (!demo?.countries?.length) return []
  return demo.countries.map((c) => {
    const code = codeOf(c.code || c.name)
    return { code, label: `${flagOf(code)}  ${nameOf(c.code || c.name)}`, value: Number(c.value) || 0, share: Number(c.share) || 0 }
  })
}

export default function AudiencePage({ platformData, range, sample, onNavigate, initialChannel = 'all', onChannelChange }) {
  const [active, setActiveState] = useState(initialChannel)
  const setActive = (v) => {
    setActiveState(v)
    onChannelChange?.(v)
  }

  const reporting = useMemo(
    () => PLATFORM_ORDER.filter((k) => demographicsOf(platformData, k)?.available),
    [platformData]
  )

  const options = useMemo(() => {
    const opts = [{ value: 'all', label: 'All channels' }]
    for (const k of PLATFORM_ORDER) {
      const d = demographicsOf(platformData, k)
      opts.push({ value: k, label: PLATFORMS[k]?.label || k, disabled: !d })
    }
    return opts
  }, [platformData])

  const effective = active
  const demo = effective === 'all' ? null : demographicsOf(platformData, effective)

  // Presence map for the "All channels" view: how many channels see a country.
  const presence = useMemo(() => {
    const counts = new Map()
    for (const k of reporting) {
      for (const c of countryRows(demographicsOf(platformData, k))) {
        if (!c.code) continue
        counts.set(c.code, (counts.get(c.code) || 0) + 1)
      }
    }
    return [...counts.entries()].map(([code, value]) => ({ code, value }))
  }, [reporting, platformData])

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Audience"
        sub={
          sample
            ? 'Sample data — the shapes below match exactly what each live platform returns.'
            : 'Age, gender, geography and devices — only what each platform actually publishes.'
        }
        right={
          <Segmented
            ariaLabel="Audience channel"
            options={options}
            value={effective}
            onChange={(v) => setActive(v)}
          />
        }
      />

      {reporting.length === 0 && (
        <NoticeBar tone="info" icon={<Info className="w-4 h-4" strokeWidth={2.2} />}>
          None of the connected channels returned audience composition for this range. YouTube publishes it once a
          channel passes its privacy threshold (~100 lifetime viewers); Instagram needs a Business account with 100+
          followers; Search Console needs search traffic in the window. This page fills in by itself as the channel grows.
        </NoticeBar>
      )}

      {effective === 'all' ? (
        <AllChannelsView platformData={platformData} reporting={reporting} presence={presence} onNavigate={onNavigate} />
      ) : demo ? (
        <ChannelView platformKey={effective} demo={demo} />
      ) : (
        <EmptyState
          icon={Lock}
          title="This channel does not publish audience composition"
          message="The upstream API for this platform returns no age, gender or location data, so there is nothing honest to draw here."
          hint="Switch to a channel above that reports demographics, or view all channels together."
        />
      )}
    </div>
  )
}

// ────────────────────────────────────────────────────────────────────────────
function AllChannelsView({ platformData, reporting, presence, onNavigate }) {
  return (
    <>
      <Card
        title="Where your audience lives"
        sub="A country shaded darker means more of your channels see an audience there. Shares from different platforms are never added together — they measure different things."
        icon={<Globe2 className="w-4 h-4" strokeWidth={2.2} />}
      >
        <WorldMap values={presence} unitLabel="channels reporting" height={300} emptyNote="No channel reported audience geography yet." />
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {PLATFORM_ORDER.map((k) => {
          const d = demographicsOf(platformData, k)
          const meta = PLATFORMS[k]
          if (!d || !d.available) {
            return (
              <Card key={k} title={meta?.label || k} icon={<Lock className="w-4 h-4" strokeWidth={2.2} />} className="opacity-70">
                <div className="flex items-start gap-3 py-2">
                  <Lock size={16} className="mt-0.5 shrink-0 text-faint" />
                  <div className="text-[12.5px] leading-relaxed text-muted">
                    No audience composition available.{' '}
                    <span className="text-faint">
                      {d?.note ||
                        (k === 'linkedin' || k === 'pinterest'
                          ? 'Zernio does not expose demographics through its public API.'
                          : 'The platform returned no demographic rows for this range.')}
                    </span>
                  </div>
                </div>
              </Card>
            )
          }
          const countries = countryRows(d).slice(0, 5)
          const topAge = d.age?.slice().sort((a, b) => b.total - a.total)[0]
          return (
            <Card
              key={k}
              title={meta?.label || k}
              sub={d.source}
              icon={<Users className="w-4 h-4" strokeWidth={2.2} />}
              right={
                <button className="btn btn-ghost btn-sm" onClick={() => onNavigate?.(`audience:${k}`)}>
                  Details
                </button>
              }
            >
              <div className="flex flex-wrap gap-1.5 pb-3">
                {DIMENSIONS.map((dim) => {
                  const has = Boolean(d[dim.key]) && !d.missing?.includes(dim.key)
                  return (
                    <Pill key={dim.key} tone={has ? 'pos' : 'neutral'}>
                      {has ? '✓' : '—'} {dim.label}
                    </Pill>
                  )
                })}
                <Pill tone="brand">{d.unit === 'share' ? '% of viewers' : 'follower counts'}</Pill>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="eyebrow mb-2">Top countries</p>
                  {countries.length ? (
                    <BarList items={countries} color={meta?.color} format={(v) => (d.unit === 'share' ? percent(v) : compact(v))} showShare={false} />
                  ) : (
                    <p className="text-[12px] text-faint">Not reported.</p>
                  )}
                </div>
                <div className="flex flex-col gap-3">
                  <div>
                    <p className="eyebrow mb-1">Strongest age group</p>
                    <p className="num text-[22px] font-semibold text-ink">{topAge ? topAge.bucket : '—'}</p>
                    <p className="text-[11.5px] text-faint">{topAge ? `${percent(topAge.total)} of the reported audience` : 'not reported'}</p>
                  </div>
                  <div>
                    <p className="eyebrow mb-1">Gender split</p>
                    {d.gender ? (
                      <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-line">
                        <div style={{ width: `${d.gender.male}%`, background: '#2F6BFF' }} />
                        <div style={{ width: `${d.gender.female}%`, background: '#E1306C' }} />
                        <div style={{ width: `${d.gender.unknown}%`, background: '#94A1B4' }} />
                      </div>
                    ) : (
                      <p className="text-[12px] text-faint">Not reported.</p>
                    )}
                    {d.gender ? (
                      <p className="mt-1 text-[11.5px] text-muted">
                        {percent(d.gender.male)} male · {percent(d.gender.female)} female
                        {d.gender.unknown > 1 ? ` · ${percent(d.gender.unknown)} undeclared` : ''}
                      </p>
                    ) : null}
                  </div>
                </div>
              </div>
            </Card>
          )
        })}
      </div>
    </>
  )
}

// ────────────────────────────────────────────────────────────────────────────
function ChannelView({ platformKey, demo }) {
  const meta = PLATFORMS[platformKey]
  const countries = countryRows(demo)
  const fmt = demo.unit === 'share' ? (v) => percent(v) : (v) => compact(v)

  return (
    <>
      {demo.note ? (
        <NoticeBar tone="info" icon={<Info className="w-4 h-4" strokeWidth={2.2} />}>
          {demo.note}
        </NoticeBar>
      ) : null}

      <Card title={`${meta?.label} · where the audience is`} sub={`${demo.source}${demo.asOf ? ` · as of ${demo.asOf}` : ''}`} icon={<Globe2 className="w-4 h-4" strokeWidth={2.2} />}>
        <WorldMap values={countries.map((c) => ({ code: c.code, value: c.value }))} unitLabel={demo.unit === 'share' ? '% of audience' : 'people'} format={fmt} height={320} />
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card title="Age & gender" icon={<Cake className="w-4 h-4" strokeWidth={2.2} />} className="lg:col-span-1">
          {demo.age?.length ? (
            <AgeSplit age={demo.age} unit={demo.unit} />
          ) : (
            <p className="py-8 text-center text-[13px] text-faint">
              {demo.missing?.includes('age') ? 'This platform does not publish age data.' : 'No age rows in this range.'}
            </p>
          )}
          {demo.gender ? (
            <div className="mt-4 border-t border-line pt-3">
              <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-line">
                <div style={{ width: `${demo.gender.male}%`, background: '#2F6BFF' }} />
                <div style={{ width: `${demo.gender.female}%`, background: '#E1306C' }} />
                <div style={{ width: `${demo.gender.unknown}%`, background: '#94A1B4' }} />
              </div>
              <div className="mt-2 flex justify-between text-[11.5px] text-muted">
                <span className="flex items-center gap-1"><i className="inline-block h-2 w-2 rounded-full" style={{ background: '#2F6BFF' }} /> {percent(demo.gender.male)} male</span>
                <span className="flex items-center gap-1"><i className="inline-block h-2 w-2 rounded-full" style={{ background: '#E1306C' }} /> {percent(demo.gender.female)} female</span>
                {demo.gender.unknown > 1 ? <span className="flex items-center gap-1"><i className="inline-block h-2 w-2 rounded-full" style={{ background: '#94A1B4' }} /> {percent(demo.gender.unknown)} n/d</span> : null}
              </div>
            </div>
          ) : null}
        </Card>

        <Card title="Top countries" icon={<Globe2 className="w-4 h-4" strokeWidth={2.2} />}>
          <BarList
            items={countries.slice(0, 8)}
            color={meta?.color}
            format={fmt}
            emptyMessage="No country rows in this range."
          />
        </Card>

        <Card title={demo.cities?.length ? 'Top cities' : 'Devices'} icon={demo.cities?.length ? <MapPin className="w-4 h-4" strokeWidth={2.2} /> : <MonitorSmartphone className="w-4 h-4" strokeWidth={2.2} />}>
          {demo.cities?.length ? (
            <BarList items={demo.cities.slice(0, 8).map((c) => ({ label: c.name, value: c.value }))} color={meta?.color} format={fmt} />
          ) : demo.devices?.length ? (
            <Donut items={demo.devices.map((d) => ({ label: d.label, value: d.value }))} centerLabel="Devices" height={180} />
          ) : (
            <p className="py-8 text-center text-[13px] text-faint">
              {demo.missing?.includes('cities') && demo.missing?.includes('devices')
                ? 'Neither cities nor devices are published by this platform.'
                : 'No rows in this range.'}
            </p>
          )}
          {demo.devices?.length && demo.cities?.length ? (
            <div className="mt-3 border-t border-line pt-3">
              <p className="eyebrow mb-2">Devices</p>
              <BarList items={demo.devices.map((d) => ({ label: d.label, value: d.value }))} color="#6B7A90" format={fmt} />
            </div>
          ) : null}
        </Card>
      </div>

      <Card title="What this platform reports" icon={<Info className="w-4 h-4" strokeWidth={2.2} />}>
        <div className="flex flex-wrap gap-1.5">
          {DIMENSIONS.map((dim) => {
            const missing = demo.missing?.includes(dim.key) || !demo[dim.key]
            return (
              <Pill key={dim.key} tone={missing ? 'neutral' : 'pos'}>
                {missing ? '—' : '✓'} {dim.label}
              </Pill>
            )
          })}
          <Pill tone="brand">{demo.unit === 'share' ? 'values are % of viewers' : 'values are counts'}</Pill>
        </div>
        <p className="mt-3 text-[12.5px] leading-relaxed text-muted">
          Source: <span className="font-medium text-body">{demo.source}</span>.{' '}
          {demo.unit === 'share'
            ? 'Percentages describe the share of people who watched, not head-counts — the platform hides absolute viewer numbers below its privacy threshold.'
            : 'Counts describe current followers, not the people reached during the selected range.'}
        </p>
      </Card>
    </>
  )
}

// ────────────────────────────────────────────────────────────────────────────
/** Mirrored horizontal bars: female left, male right, bucket in the middle. */
function AgeSplit({ age, unit }) {
  const max = Math.max(...age.map((a) => Math.max(a.female, a.male)), 1)
  return (
    <div className="flex flex-col gap-1.5">
      {age.map((row) => (
        <div key={row.bucket} className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
          <div className="flex justify-end">
            <div
              className="h-4 rounded-l-sm"
              style={{ width: `${(row.female / max) * 100}%`, background: '#E1306C', minWidth: row.female > 0 ? 2 : 0 }}
              title={`female ${row.female}`}
            />
          </div>
          <span className={cls('num w-14 text-center text-[11px] font-semibold', 'text-ink')}>{row.bucket}</span>
          <div className="flex">
            <div
              className="h-4 rounded-r-sm"
              style={{ width: `${(row.male / max) * 100}%`, background: '#2F6BFF', minWidth: row.male > 0 ? 2 : 0 }}
              title={`male ${row.male}`}
            />
          </div>
        </div>
      ))}
      <div className="mt-1 flex justify-between text-[10.5px] text-faint">
        <span>female</span>
        <span>{unit === 'share' ? '% of viewers' : 'followers'}</span>
        <span>male</span>
      </div>
    </div>
  )
}
