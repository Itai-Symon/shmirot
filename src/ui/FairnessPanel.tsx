import { t } from '../i18n'
import type { SolverOutput } from '../solver/types'
import { certificateNotice, loadSpreadHours, warningNotices, type Notice } from './fairness'
import type { RoleRecord } from './labels'

/** Certificate, spread and warnings of a schedule (used before creating and on the board). */
export function FairnessPanel(props: {
  output: SolverOutput | null
  roles: RoleRecord[] | undefined
  restMinutes: number
  busy?: boolean
  compact?: boolean
}) {
  if (props.busy && !props.output) return <p className="muted small-print">{t.fairness.computing}</p>
  if (!props.output) return null
  const cert = certificateNotice(props.output.certificate, props.restMinutes)
  const warnings = warningNotices(props.output, props.roles, props.restMinutes)
  const spread = loadSpreadHours(props.output)
  const notices: Notice[] = [
    ...(cert ? [cert] : []),
    ...(props.compact ? [] : [{ level: 'info' as const, text: t.fairness.spread(spread.toFixed(1)) }]),
    ...warnings,
  ]
  if (props.compact && warnings.length === 0 && !cert) return null
  return (
    <ul className={props.busy ? 'notices busy' : 'notices'} aria-live="polite">
      {notices.map((n, i) => (
        <li key={i} className={`notice ${n.level}`}>
          {n.text}
        </li>
      ))}
      {!props.compact && warnings.length === 0 && <li className="notice ok">{t.fairness.allGood}</li>}
    </ul>
  )
}
