import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react'
import { postName } from './labels'
import { FairnessPanel } from './FairnessPanel'
import { BoardScore } from './BoardScore'
import { WhySheet } from './WhySheet'
import { t } from '../i18n'
import type { SoldierId } from '../solver/types'
import type { Plan, SoldierRecord } from '../storage/db'
import { type BoardRow, boardRows, isAbsentAt, minuteAt, whatsappText } from './planner'
import { Sheet } from './widgets'

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    // Fallback for older WebViews / non-secure contexts.
    const ta = document.createElement('textarea')
    ta.value = text
    ta.setAttribute('readonly', '')
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.select()
    let ok = false
    try {
      ok = document.execCommand('copy')
    } catch {
      ok = false
    }
    ta.remove()
    return ok
  }
}

function useNow(): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 30_000)
    return () => window.clearInterval(id)
  }, [])
  return now
}

type View = 'post' | 'time'

export function BoardScreen(props: {
  plan: Plan | undefined
  soldiers: SoldierRecord[]
  onToggleHome: (id: SoldierId, nowMs: number) => void
  onGoCreate: () => void
  toast: (msg: string) => void
}) {
  const { plan, soldiers } = props
  const nowMs = useNow()
  const [view, setView] = useState<View>('post')
  const [picked, setPicked] = useState<SoldierId | null>(null)
  const [why, setWhy] = useState<{ id: string; label: string } | null>(null)
  const rows = useMemo(() => (plan ? boardRows(plan, soldiers) : []), [plan, soldiers])
  const rootRef = useRef<HTMLElement>(null)
  // Bring the running shift into view when the board opens or the view changes.
  useEffect(() => {
    rootRef.current?.querySelector('.current')?.scrollIntoView({ block: 'center' })
  }, [view, plan?.generated.startEpochMs])

  if (!plan) {
    return (
      <section className="screen">
        <h1>{t.board.title}</h1>
        <p className="muted center">{t.board.empty}</p>
        <button type="button" className="btn primary" onClick={props.onGoCreate}>
          {t.board.goCreate}
        </button>
      </section>
    )
  }

  const now = minuteAt(plan, nowMs)
  const names = new Map(soldiers.map((s) => [s.id, s.name]))
  const home = plan.soldierIds.filter((id) => isAbsentAt(plan.absences[id], now))
  const ended = now >= plan.generated.endMinute

  const copy = async () => {
    const ok = await copyText(whatsappText(plan, soldiers, now))
    props.toast(ok ? t.board.copied : t.board.copyFailed)
  }
  const share = async () => {
    try {
      await navigator.share({ text: whatsappText(plan, soldiers, now) })
    } catch {
      /* user cancelled */
    }
  }
  const canShare = typeof navigator.share === 'function'

  const renderRow = (r: BoardRow, showPost: boolean) => {
    const past = r.end <= now
    const current = r.start <= now && now < r.end
    return (
      <li key={r.shiftId} className={`shift${past ? ' past' : ''}${current ? ' current' : ''}`}>
        <div className="shift-time">
          <span className="ltr">{r.startLabel}</span>
          <small className="muted ltr">{r.endLabel}</small>
        </div>
        <div className="shift-body">
          {showPost && <small className="muted">{r.postLabel}</small>}
          <div className="names">
            {r.people.map((p) => (
              <button
                key={p.soldierId}
                type="button"
                className={`name${p.locked ? ' locked' : ''}${!past && isAbsentAt(plan.absences[p.soldierId], now) ? ' away' : ''}`}
                onClick={() => setPicked(p.soldierId)}
              >
                {p.name}
              </button>
            ))}
            {r.missing.map((m) => (
              <span key={m.role} className="missing">
                {t.board.missing(m.role, m.n)}
              </span>
            ))}
          </div>
        </div>
        {current && <span className="now-badge">{t.board.nowLabel}</span>}
        {plan.input && (
          <button type="button" className="link why-btn" onClick={() => setWhy({ id: r.shiftId, label: `${r.startLabel}–${r.endLabel}` })}>
            {t.fairness.why}
          </button>
        )}
      </li>
    )
  }

  const withDays = (list: BoardRow[], showPost: boolean) => {
    const out: ReactNode[] = []
    let day: number | null = null
    for (const r of list) {
      if (r.dayKey !== day) {
        day = r.dayKey
        out.push(
          <li key={`d${r.dayKey}-${r.shiftId}`} className="day">
            {r.dayLabel}
          </li>,
        )
      }
      out.push(renderRow(r, showPost))
    }
    return out
  }

  const posts = [...new Set(rows.map((r) => r.postIndex))].sort((a, b) => a - b)
  const pickedAway = picked ? isAbsentAt(plan.absences[picked], now) : false

  return (
    <section className="screen board" ref={rootRef}>
      <div className="board-actions">
        <button type="button" className="btn primary big" onClick={copy}>
          {t.board.copy}
        </button>
        {canShare && (
          <button type="button" className="btn" onClick={share}>
            {t.board.share}
          </button>
        )}
      </div>

      <FairnessPanel output={plan.output} roles={plan.roles} restMinutes={plan.settings.restMinutes} compact />
      <BoardScore plan={plan} soldiers={soldiers} />

      <div className="segmented" role="tablist">
        <button type="button" role="tab" aria-selected={view === 'post'} onClick={() => setView('post')}>
          {t.board.byPost}
        </button>
        <button type="button" role="tab" aria-selected={view === 'time'} onClick={() => setView('time')}>
          {t.board.byTime}
        </button>
      </div>

      {ended && <p className="muted center">{t.board.endedNote}</p>}

      {home.length > 0 && (
        <div className="home-bar">
          <span>{t.board.atHome}:</span>
          {home.map((id) => (
            <button key={id} type="button" className="name away" onClick={() => setPicked(id)}>
              {names.get(id) ?? t.board.unknownSoldier}
            </button>
          ))}
        </div>
      )}

      {view === 'post' ? (
        posts.map((p) => (
          <div key={p} className="post-block">
            <h2>{postName(plan.settings.posts, p)}</h2>
            <ul className="shifts">{withDays(rows.filter((r) => r.postIndex === p), false)}</ul>
          </div>
        ))
      ) : (
        <ul className="shifts">{withDays(rows, posts.length > 1)}</ul>
      )}

      <p className="muted center small-print">{t.board.lockedHint}</p>

      {why && <WhySheet plan={plan} shiftId={why.id} label={why.label} soldiers={soldiers} onClose={() => setWhy(null)} />}

      {picked && (
        <Sheet onClose={() => setPicked(null)}>
          <h2>{names.get(picked) ?? t.board.unknownSoldier}</h2>
          <p className="muted">{pickedAway ? t.board.isHome : t.board.isHere}</p>
          <button
            type="button"
            className={pickedAway ? 'btn primary big' : 'btn danger big'}
            disabled={ended}
            onClick={() => {
              props.onToggleHome(picked, Date.now())
              setPicked(null)
            }}
          >
            {pickedAway ? t.board.cameBack : t.board.wentHome}
          </button>
          <button type="button" className="btn" onClick={() => setPicked(null)}>
            {t.board.cancel}
          </button>
        </Sheet>
      )}
    </section>
  )
}
