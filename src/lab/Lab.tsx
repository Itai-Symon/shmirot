/**
 * Lab: pick or edit a scenario, run the REAL solver in both balance modes, and see the input,
 * the output, the independent verifier's verdict, and where the two modes differ.
 */
import { useMemo, useState } from 'react'
import { solve } from '../solver'
import type { SolverInput, SolverOutput, Violation } from '../solver/types'
import { verify } from '../verifier'
import { PRESETS, buildInput, soldierName, type Scenario } from './scenario'

interface Run {
  input: SolverInput
  output: SolverOutput
  violations: Violation[]
  ms: number
}

function run(sc: Scenario, balance: 'weighted' | 'separate'): Run {
  const input = buildInput(sc, balance)
  const t0 = performance.now()
  const output = solve(input)
  const ms = performance.now() - t0
  return { input, output, violations: verify(input, output), ms }
}

const h = (m: number) => (m / 60).toFixed(1)

function perSoldier(r: Run) {
  const byId = new Map(r.input.shifts.map((s) => [s.id, s]))
  return r.input.soldiers.map((s) => {
    let day = 0
    let night = 0
    for (const a of r.output.assignments) {
      if (a.soldierId !== s.id) continue
      const sh = byId.get(a.shiftId)!
      night += sh.nightMinutes
      day += sh.end - sh.start - sh.nightMinutes
    }
    const st = r.output.stats.find((x) => x.soldierId === s.id)!
    return { id: s.id, day, night, weighted: st.load, shifts: st.shiftCount, minRest: st.minRestMinutes }
  })
}

function gap(v: number[]) {
  return v.length ? Math.max(...v) - Math.min(...v) : 0
}

function Timeline(props: { r: Run; other: Run; maxShifts: number }) {
  const { r, other } = props
  const shifts = [...r.input.shifts].sort((a, b) => a.start - b.start || a.postIndex - b.postIndex).slice(0, props.maxShifts)
  const otherSeat = new Set(other.output.assignments.map((a) => `${a.shiftId}|${a.soldierId}`))
  const seat = new Set(r.output.assignments.map((a) => `${a.shiftId}|${a.soldierId}`))
  const label = (m: number) => {
    const t = (20 * 60 + m) % (24 * 60)
    return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`
  }
  return (
    <div className="lab-timeline">
      <table>
        <thead>
          <tr>
            <th />
            {shifts.map((s) => (
              <th key={s.id} title={`${label(s.start)}–${label(s.end)} · עמדה ${s.postIndex + 1}`}>
                <span className={s.nightMinutes > 0 ? 'n' : ''}>{label(s.start).slice(0, 2)}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {r.input.soldiers.map((sol) => (
            <tr key={sol.id}>
              <th>{soldierName(sol.id)}</th>
              {shifts.map((s) => {
                const on = seat.has(`${s.id}|${sol.id}`)
                const diff = on !== otherSeat.has(`${s.id}|${sol.id}`)
                const away = sol.absences.some((a) => a.start < s.end && s.start < a.end)
                return (
                  <td
                    key={s.id}
                    className={`${on ? (s.nightMinutes > 0 ? 'on night' : 'on') : ''}${diff ? ' diff' : ''}${away ? ' away' : ''}`}
                    title={`${soldierName(sol.id)} · ${label(s.start)}–${label(s.end)} · עמדה ${s.postIndex + 1}${on ? ' · שומר' : ''}`}
                  >
                    {on ? s.postIndex + 1 : ''}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function Num(props: { label: string; value: number; onChange: (v: number) => void; min?: number; max?: number; step?: number }) {
  return (
    <label className="lab-num">
      <span>{props.label}</span>
      <input type="number" value={props.value} min={props.min} max={props.max} step={props.step ?? 1} onChange={(e) => props.onChange(Number(e.target.value))} />
    </label>
  )
}

export function Lab() {
  const [sc, setSc] = useState<Scenario>(PRESETS[1])
  const [maxShifts, setMaxShifts] = useState(48)
  const set = (patch: Partial<Scenario>) => setSc({ ...sc, ...patch })
  const { w, s } = useMemo(() => ({ w: run(sc, 'weighted'), s: run(sc, 'separate') }), [sc])
  const pw = perSoldier(w)
  const ps = perSoldier(s)
  const differing = w.output.assignments.filter((a) => !s.output.assignments.some((b) => b.shiftId === a.shiftId && b.soldierId === a.soldierId)).length

  const modeSummary = (name: string, r: Run, rows: ReturnType<typeof perSoldier>) => (
    <div className="card">
      <h3>{name}</h3>
      <ul className="lab-facts">
        <li className={r.violations.length ? 'bad' : 'good'}>
          בודק עצמאי: {r.violations.length ? `${r.violations.length} הפרות` : 'תקין ✓'}
        </li>
        <li>מקומות מאוישים: {r.output.assignments.length}, חוסרים: {r.output.shortages.reduce((n, x) => n + x.missing, 0)}</li>
        <li>
          מנוחה מינימלית: {r.output.certificate.achievedMinRestMinutes === null ? '—' : h(r.output.certificate.achievedMinRestMinutes)} ש׳
          {r.output.certificate.upperBoundMinRestMinutes !== null && ` (חסם עליון ${h(r.output.certificate.upperBoundMinRestMinutes)} ש׳${r.output.certificate.provenOptimal ? ', מוכח אופטימלי' : ''})`}
        </li>
        <li>פער שעות יום: {h(gap(rows.map((x) => x.day)))} · פער שעות לילה: {h(gap(rows.map((x) => x.night)))} · פער משוקלל: {h(gap(rows.map((x) => x.weighted)))}</li>
        <li>אזהרות: {r.output.warnings.map((x) => x.code).join(', ') || 'אין'}</li>
        <li>זמן חישוב: {r.ms.toFixed(0)} אלפיות שנייה</li>
      </ul>
      {r.violations.length > 0 && <pre className="lab-json">{JSON.stringify(r.violations.slice(0, 10), null, 2)}</pre>}
    </div>
  )

  return (
    <main className="lab" dir="rtl">
      <h1>מעבדה</h1>
      <p className="muted">
        בוחרים תרחיש או משנים מספרים. האלגוריתם האמיתי של האפליקציה רץ פעמיים – באיזון "משוקלל" ובאיזון "בנפרד" – והבודק העצמאי בודק כל תוצאה. אפשר לראות את הקלט המלא ואת הפלט המלא.
      </p>

      <div className="chips small">
        {PRESETS.map((p) => (
          <button key={p.title} type="button" className={p.title === sc.title ? 'chip on' : 'chip'} onClick={() => setSc(p)}>
            {p.title}
          </button>
        ))}
      </div>

      <div className="card lab-controls">
        <Num label="חיילים" value={sc.soldiers} min={1} max={60} onChange={(v) => set({ soldiers: v, title: '' })} />
        <Num label="מתוכם מפקדים" value={sc.commanders} min={0} max={sc.soldiers} onChange={(v) => set({ commanders: v, title: '' })} />
        <Num label="ימים" value={sc.days} min={1} max={30} onChange={(v) => set({ days: v, title: '' })} />
        <Num label="משמרת (דק׳)" value={sc.shiftMinutes} min={15} max={720} step={15} onChange={(v) => set({ shiftMinutes: v, title: '' })} />
        <Num label="מנוחה (דק׳)" value={sc.restMinutes} min={0} max={1440} step={15} onChange={(v) => set({ restMinutes: v, title: '' })} />
        <Num label="לילה שווה פי" value={sc.nightWeight} min={1} max={3} step={0.25} onChange={(v) => set({ nightWeight: v, title: '' })} />
        <label className="lab-num">
          <span>פיצול יום/לילה</span>
          <input type="checkbox" checked={sc.splitNight} onChange={(e) => set({ splitNight: e.target.checked, title: '' })} />
        </label>
        {sc.splitNight && <Num label="משמרת לילה (דק׳)" value={sc.nightShiftMinutes} min={15} max={720} step={15} onChange={(v) => set({ nightShiftMinutes: v, title: '' })} />}
        <label className="lab-num">
          <span>יציאות הביתה</span>
          <input type="checkbox" checked={sc.homeRotation} onChange={(e) => set({ homeRotation: e.target.checked, title: '' })} />
        </label>
        <Num label="עמדות" value={sc.posts.length} min={1} max={6} onChange={(v) => set({ posts: Array.from({ length: v }, (_, i) => sc.posts[i] ?? { people: 1, commander: false, weight: 1, nightOnly: false }), title: '' })} />
        {sc.posts.map((p, i) => (
          <div key={i} className="lab-post">
            <strong>עמדה {i + 1}</strong>
            <Num label="אנשים" value={p.people} min={1} max={4} onChange={(v) => set({ posts: sc.posts.map((q, j) => (j === i ? { ...q, people: v } : q)), title: '' })} />
            <Num label="קושי פי" value={p.weight} min={0.5} max={2} step={0.1} onChange={(v) => set({ posts: sc.posts.map((q, j) => (j === i ? { ...q, weight: v } : q)), title: '' })} />
            <label className="lab-num"><span>כולל מפקד</span><input type="checkbox" checked={p.commander} onChange={(e) => set({ posts: sc.posts.map((q, j) => (j === i ? { ...q, commander: e.target.checked } : q)), title: '' })} /></label>
            <label className="lab-num"><span>רק בלילה</span><input type="checkbox" checked={p.nightOnly} onChange={(e) => set({ posts: sc.posts.map((q, j) => (j === i ? { ...q, nightOnly: e.target.checked } : q)), title: '' })} /></label>
          </div>
        ))}
      </div>

      <h2>קלט</h2>
      <p>
        {w.input.soldiers.length} חיילים · {w.input.shifts.length} משמרות · {w.output.assignments.length + w.output.shortages.reduce((n, x) => n + x.missing, 0)} מקומות · מנוחה רצויה {h(sc.restMinutes)} ש׳ · לילה = בין חצות ל־06:00
      </p>
      <details>
        <summary>הקלט המלא שנשלח לאלגוריתם (JSON)</summary>
        <pre className="lab-json">{JSON.stringify(w.input, null, 1)}</pre>
      </details>

      <h2>פלט</h2>
      <p className={differing ? 'good' : 'muted'}>
        {differing ? `שני האיזונים נותנים לוח שונה: ${differing} מתוך ${w.output.assignments.length} מקומות שונים (מסומנים במסגרת).` : 'בתרחיש הזה שני האיזונים נותנים בדיוק אותו לוח.'}
      </p>
      <div className="lab-modes">
        {modeSummary('משוקלל', w, pw)}
        {modeSummary('בנפרד', s, ps)}
      </div>

      <h3>שעות לכל חייל</h3>
      <div className="stats-card card">
        <table className="stats">
          <thead>
            <tr><th /><th>יום · משוקלל</th><th>לילה · משוקלל</th><th>יום · בנפרד</th><th>לילה · בנפרד</th></tr>
          </thead>
          <tbody>
            {pw.map((x, i) => (
              <tr key={x.id}>
                <td>{soldierName(x.id)}</td>
                <td className="num">{h(x.day)}</td>
                <td className="num">{h(x.night)}</td>
                <td className="num">{h(ps[i].day)}</td>
                <td className="num">{h(ps[i].night)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h3>הלוח עצמו</h3>
      <p className="muted small-print">
        שורה = חייל, עמודה = משמרת (השעה למעלה, כחול = לילה). המספר בתא = העמדה. מסגרת = התא שונה בין שני האיזונים. אפור = בבית.
        <label> מציגים <input type="number" value={maxShifts} min={6} max={600} step={6} onChange={(e) => setMaxShifts(Number(e.target.value))} /> משמרות ראשונות</label>
      </p>
      <h4>משוקלל</h4>
      <Timeline r={w} other={s} maxShifts={maxShifts} />
      <h4>בנפרד</h4>
      <Timeline r={s} other={w} maxShifts={maxShifts} />

      <details>
        <summary>הפלט המלא של האלגוריתם – משוקלל (JSON)</summary>
        <pre className="lab-json">{JSON.stringify(w.output, null, 1)}</pre>
      </details>
      <details>
        <summary>הפלט המלא של האלגוריתם – בנפרד (JSON)</summary>
        <pre className="lab-json">{JSON.stringify(s.output, null, 1)}</pre>
      </details>
    </main>
  )
}
