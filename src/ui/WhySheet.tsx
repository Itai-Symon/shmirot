import { t } from '../i18n'
import { explain } from '../solver'
import type { CandidateExplanation } from '../solver/types'
import type { Plan, SoldierRecord } from '../storage/db'
import { postName, roleName } from './labels'
import { Sheet } from './widgets'

const h = (m: number) => {
  const x = m / 60
  return Number.isInteger(x) ? String(x) : x.toFixed(1)
}

function detail(c: CandidateExplanation): string {
  const parts: string[] = []
  if (c.rank !== undefined) parts.push(t.fairness.rankLabel(c.rank + 1))
  if (c.restMinutes === null) parts.push(t.fairness.neverGuarded)
  else if (c.restMinutes !== undefined) parts.push(c.rested ? t.fairness.restedFor(h(c.restMinutes)) : t.fairness.stillResting(h(c.restMinutes)))
  if (c.deviation !== undefined) {
    parts.push(Math.abs(c.deviation) < 3 ? t.fairness.atFair : t.fairness.vsFair(h(Math.abs(c.deviation)), c.deviation > 0))
  }
  return parts.join(' · ')
}

/** "Why him?" for one shift, replayed from the exact solver input of the plan. */
export function WhySheet(props: { plan: Plan; shiftId: string; label: string; soldiers: SoldierRecord[]; onClose: () => void }) {
  const { plan } = props
  const ex = plan.input ? explain(plan.input, props.shiftId) : null
  const shift = plan.generated.shifts.find((s) => s.id === props.shiftId)
  const names = new Map(props.soldiers.map((s) => [s.id, s.name]))
  return (
    <Sheet onClose={props.onClose}>
      <h2>
        {shift ? postName(plan.settings.posts, shift.postIndex) : ''} · <bdi dir="ltr">{props.label}</bdi>
      </h2>
      <p className="muted small-print">{t.fairness.whyRule(plan.settings.brotherhoodFactor ?? 1)}</p>
      {!ex ? (
        <p className="muted">—</p>
      ) : (
        <ul className="why-list">
          {ex.candidates.map((c) => (
            <li key={c.soldierId} className={`why ${c.status}`}>
              <div className="row-between">
                <strong>{names.get(c.soldierId) ?? '?'}</strong>
                <span className="muted">
                  {t.fairness.st[c.status]}
                  {c.role && c.status === 'chosen' ? ` · ${roleName(plan.roles, c.role)}` : ''}
                </span>
              </div>
              {detail(c) && <small className="muted">{detail(c)}</small>}
            </li>
          ))}
        </ul>
      )}
      <button type="button" className="btn" onClick={props.onClose}>
        {t.board.cancel}
      </button>
    </Sheet>
  )
}
