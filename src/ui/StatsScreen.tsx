import { useEffect, useMemo, useState } from 'react'
import { t } from '../i18n'
import type { Plan, SoldierRecord } from '../storage/db'
import { wallAt } from '../storage/shiftGenerator'
import { activityTotals, sumTotals, type ActivityRecord, type SoldierTotals } from './history'

const hm = (m: number) => `${Math.floor(m / 60)}:${String(Math.round(m % 60)).padStart(2, '0')}`

export function StatsScreen(props: {
  plan: Plan | undefined
  history: ActivityRecord[]
  soldiers: SoldierRecord[]
  onDeleteActivity: (id: string) => void
}) {
  const [nowMs, setNowMs] = useState(() => Date.now())
  const [selected, setSelected] = useState<string>('all')
  const [confirm, setConfirm] = useState(false)
  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), 60_000)
    return () => window.clearInterval(timer)
  }, [])

  const records: (ActivityRecord & { current: boolean })[] = useMemo(() => {
    const past = props.history.map((r) => ({ ...r, current: false }))
    const cur = props.plan
      ? [{ id: props.plan.id ?? 'current', plan: props.plan, names: {}, closedAtMinute: null, current: true }]
      : []
    return [...past, ...cur]
  }, [props.history, props.plan])

  const names = new Map<string, string>()
  for (const r of records) for (const [id, n] of Object.entries(r.names)) names.set(id, n)
  for (const s of props.soldiers) names.set(s.id, s.name)
  const inPlatoon = new Set(props.soldiers.map((s) => s.id))

  const shown = selected === 'all' ? records : records.filter((r) => r.id === selected)
  const totals: SoldierTotals[] = sumTotals(shown.map((r) => activityTotals(r, nowMs)))
    .filter((x) => x.dayGuardMinutes + x.nightGuardMinutes + x.restMinutes + x.homeMinutes > 0)
    .sort((a, b) => b.dayGuardMinutes + b.nightGuardMinutes - (a.dayGuardMinutes + a.nightGuardMinutes) || (names.get(a.soldierId) ?? '').localeCompare(names.get(b.soldierId) ?? '', 'he'))

  const label = (r: ActivityRecord & { current: boolean }) =>
    t.stats.activity(wallAt(r.plan.generated.startEpochMs, 0, r.plan.settings.timeZone).date, r.current)
  const selectedRec = records.find((r) => r.id === selected)

  return (
    <section className="screen">
      <h1>{t.stats.title}</h1>
      {records.length > 0 && (
        <div className="chips small">
          {[{ id: 'all', text: t.stats.all }, ...records.map((r) => ({ id: r.id, text: label(r) }))].map((o) => (
            <button
              key={o.id}
              type="button"
              aria-pressed={selected === o.id}
              className={selected === o.id ? 'chip on' : 'chip'}
              onClick={() => {
                setSelected(o.id)
                setConfirm(false)
              }}
            >
              {o.text}
            </button>
          ))}
        </div>
      )}

      {totals.length === 0 ? (
        <p className="muted center">{t.stats.empty}</p>
      ) : (
        <div className="card stats-card">
          <table className="stats">
            <thead>
              <tr>
                <th>{t.stats.name}</th>
                <th>{t.stats.day}</th>
                <th>{t.stats.night}</th>
                <th>{t.stats.rest}</th>
                <th>{t.stats.home}</th>
                <th>{t.stats.shifts}</th>
              </tr>
            </thead>
            <tbody>
              {totals.map((x) => (
                <tr key={x.soldierId}>
                  <td>
                    {names.get(x.soldierId) ?? '?'}
                    {!inPlatoon.has(x.soldierId) && <small className="muted"> {t.stats.removed}</small>}
                  </td>
                  <td>{hm(x.dayGuardMinutes)}</td>
                  <td>{hm(x.nightGuardMinutes)}</td>
                  <td>{hm(x.restMinutes)}</td>
                  <td>{hm(x.homeMinutes)}</td>
                  <td>{x.shifts}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="muted small-print">{t.stats.note}</p>

      {selectedRec && !selectedRec.current && (
        <button
          type="button"
          className={confirm ? 'btn danger' : 'btn'}
          onBlur={() => setConfirm(false)}
          onClick={() => {
            if (!confirm) return setConfirm(true)
            setConfirm(false)
            setSelected('all')
            props.onDeleteActivity(selectedRec.id)
          }}
        >
          {confirm ? t.stats.deleteConfirm : t.stats.deleteActivity}
        </button>
      )}
    </section>
  )
}
