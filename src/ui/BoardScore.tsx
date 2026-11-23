import { t } from '../i18n'
import type { Plan, SoldierRecord } from '../storage/db'
import { boardScore } from './fairness'

const h1 = (m: number) => (m / 60).toFixed(1)
const signed = (m: number) => `${m > 3 ? '+' : m < -3 ? '−' : ''}${Math.abs(m / 60).toFixed(1)}`

/** Before / on this board / after, per soldier, and the overall gap. */
export function BoardScore(props: { plan: Pick<Plan, 'history' | 'output' | 'soldierIds'>; soldiers: SoldierRecord[] }) {
  const score = boardScore(props.plan)
  const names = new Map(props.soldiers.map((s) => [s.id, s.name]))
  const rows = [...score.rows].sort((a, b) => b.after - a.after)
  return (
    <details className="card score">
      <summary>
        <strong>{t.fairness.scoreTitle}</strong>{' '}
        <span className="muted">{t.fairness.scoreSpread(h1(score.spreadBefore), h1(score.spreadAfter))}</span>
      </summary>
      <div className="stats-card">
        <table className="stats">
          <thead>
            <tr>
              <th />
              <th>{t.fairness.colBefore}</th>
              <th>{t.fairness.colOnBoard}</th>
              <th>{t.fairness.colAfter}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.soldierId}>
                <td>{names.get(r.soldierId) ?? '?'}</td>
                <td className="num">{signed(r.before)}</td>
                <td className="num">{h1(r.onBoard)}</td>
                <td className="num">{signed(r.after)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted small-print">{t.fairness.scoreHint}</p>
    </details>
  )
}
