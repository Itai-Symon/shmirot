import { useCallback, useEffect, useRef, useState } from 'react'
import { t } from './i18n'
import type { SoldierId, SolverOutput } from './solver/types'
import {
  type ActivitySettings,
  type Plan,
  type SoldierRecord,
  loadPlan,
  loadRoles,
  loadSettings,
  loadSoldiers,
  requestPersistence,
  savePlan,
  saveRoles,
  saveSettings,
  saveSoldiers,
} from './storage/db'
import { ActivityScreen } from './ui/ActivityScreen'
import { BoardScreen } from './ui/BoardScreen'
import { hasStarted } from './ui/history'
import { emptyLedger, foldPlan, toHistory, type Ledger } from './ui/ledger'
import { PlatoonScreen } from './ui/PlatoonScreen'
import { defaultSettings } from './ui/defaults'
import { createPlan, minuteAt, toggleHome } from './ui/planner'
import { solveInWorker } from './ui/solverClient'
import { defaultRoles, type RoleRecord } from './ui/labels'

type Tab = 'platoon' | 'activity' | 'board'

export default function App() {
  const [ready, setReady] = useState(false)
  const [tab, setTab] = useState<Tab>('platoon')
  const [soldiers, setSoldiers] = useState<SoldierRecord[]>([])
  const [settings, setSettings] = useState<ActivitySettings>(() => defaultSettings(Date.now()))
  const [plan, setPlan] = useState<Plan | undefined>()
  const [roles, setRoles] = useState<RoleRecord[]>(defaultRoles)
  const [preview, setPreview] = useState<SolverOutput | null>(null)
  const [previewBusy, setPreviewBusy] = useState(false)
  const previewSeq = useRef(0)
  const [toastMsg, setToastMsg] = useState<string | null>(null)
  const toastTimer = useRef<number | undefined>(undefined)

  const toast = useCallback((msg: string) => {
    setToastMsg(msg)
    window.clearTimeout(toastTimer.current)
    toastTimer.current = window.setTimeout(() => setToastMsg(null), 2500)
  }, [])

  useEffect(() => {
    requestPersistence()
    Promise.all([loadSoldiers(), loadSettings(), loadPlan(), loadRoles()])
      .then(([s, st, p, rl]) => {
        setSoldiers(s)
        if (rl && rl.length) setRoles(rl)
        if (st) {
          // A stale start time is moved to the next full hour, keeping everything else.
          const fresh = defaultSettings(Date.now())
          const stale = !p && st.start < fresh.start
          setSettings(stale ? { ...st, start: fresh.start, end: st.durationHours ? fresh.end : st.end, timeZone: fresh.timeZone } : st)
        }
        setPlan(p)
        setTab(p ? 'board' : s.length ? 'activity' : 'platoon')
      })
      .catch(() => undefined)
      .finally(() => setReady(true))
  }, [])

  // Live pre-flight preview on the activity screen: solve the would-be plan (debounced, in the worker).
  useEffect(() => {
    if (tab !== 'activity') return
    const seq = ++previewSeq.current
    setPreviewBusy(true)
    const timer = window.setTimeout(() => {
      const ledgers = foldedLedgers(Date.now())
      createPlan(settings, soldiers, solveInWorker, roles, (start) => toHistory(ledgers, start))
        .then((r) => {
          if (seq === previewSeq.current) setPreview(typeof r === 'string' ? null : r.output)
        })
        .catch(() => seq === previewSeq.current && setPreview(null))
        .finally(() => seq === previewSeq.current && setPreviewBusy(false))
    }, 300)
    return () => window.clearTimeout(timer)
  }, [tab, settings, soldiers, roles])

  const updateSoldiers = (list: SoldierRecord[]) => {
    setSoldiers(list)
    void saveSoldiers(list)
  }
  const updateSettings = (s: ActivitySettings) => {
    setSettings(s)
    void saveSettings(s)
  }
  /** Roles changed: removed roles are also removed from soldiers and from post requirements. */
  const updateRoles = (next: RoleRecord[]) => {
    const keep = new Set(next.map((r) => r.id))
    setRoles(next)
    void saveRoles(next)
    if (soldiers.some((s) => s.roles.some((r) => !keep.has(r)))) {
      updateSoldiers(soldiers.map((s) => ({ ...s, roles: s.roles.filter((r) => keep.has(r)) })))
    }
    if (settings.posts.some((p) => Object.keys(p.requirements).some((r) => !keep.has(r)))) {
      updateSettings({
        ...settings,
        posts: settings.posts.map((p) => ({
          ...p,
          requirements: Object.fromEntries(Object.entries(p.requirements).filter(([r]) => keep.has(r))),
        })),
      })
    }
  }
  const updatePlan = (p: Plan) => {
    setPlan(p)
    void savePlan(p)
  }

  const busy = useRef(false)

  /** Ledgers as they will be once the current board is replaced now. */
  const foldedLedgers = (nowMs: number): Map<SoldierId, Ledger> => {
    const base = new Map(soldiers.map((s) => [s.id, s.ledger ?? emptyLedger()]))
    return plan && hasStarted(plan, nowMs) ? foldPlan(base, plan, nowMs) : base
  }

  const create = async () => {
    if (busy.current) return
    busy.current = true
    let result: Awaited<ReturnType<typeof createPlan>>
    const nowMs = Date.now()
    const ledgers = foldedLedgers(nowMs)
    try {
      result = await createPlan(settings, soldiers, solveInWorker, roles, (start) => toHistory(ledgers, start))
    } catch {
      toast(t.board.solverError)
      return
    } finally {
      busy.current = false
    }
    if (typeof result === 'string') {
      toast(t.activity[result])
      if (result === 'errNoSoldiers') setTab('platoon')
      return
    }
    // What happened on the replaced board is now in each soldier's ledger.
    if (plan && hasStarted(plan, nowMs)) {
      updateSoldiers(soldiers.map((s) => ({ ...s, ledger: ledgers.get(s.id) ?? s.ledger })))
      // Time already in the ledgers is not counted again on the new board.
      const closedMs = Math.min(nowMs, plan.generated.startEpochMs + plan.generated.endMinute * 60_000)
      if (closedMs > result.generated.startEpochMs) result = { ...result, countFromMs: closedMs }
    }
    updatePlan(result)
    setTab('board')
    window.scrollTo(0, 0)
  }

  /** "Reset load": everyone starts from zero; the current board counts only from now. */
  const resetLoad = () => {
    const nowMs = Date.now()
    updateSoldiers(soldiers.map((s) => ({ ...s, ledger: emptyLedger() })))
    if (plan) updatePlan({ ...plan, countFromMs: nowMs, history: [] })
    toast(t.platoon.loadReset)
  }

  const onToggleHome = async (id: SoldierId, nowMs: number) => {
    if (!plan || busy.current) return
    busy.current = true
    try {
      updatePlan(await toggleHome(plan, soldiers, id, minuteAt(plan, nowMs), solveInWorker))
      toast(t.board.replanned)
    } catch {
      toast(t.board.solverError)
    } finally {
      busy.current = false
    }
  }

  const go = (next: Tab) => {
    setTab(next)
    window.scrollTo(0, 0)
  }

  return (
    <div className="app" dir="rtl">
      <main>
        {!ready ? null : tab === 'platoon' ? (
          <PlatoonScreen plan={plan} onResetLoad={resetLoad} soldiers={soldiers} onChange={updateSoldiers} roles={roles} onRolesChange={updateRoles} onNext={() => go('activity')} toast={toast} />
        ) : tab === 'activity' ? (
          <ActivityScreen preview={preview} previewBusy={previewBusy} roles={roles} settings={settings} onChange={updateSettings} hasPlan={!!plan} onCreate={() => void create()} />
        ) : (
          <BoardScreen
            plan={plan}
            soldiers={soldiers}
            onToggleHome={(id, ms) => void onToggleHome(id, ms)}
            onGoCreate={() => go('activity')}
            toast={toast}
          />
        )}
      </main>

      {toastMsg && (
        <div className="toast" role="status">
          {toastMsg}
        </div>
      )}

      <nav className="tabs">
        {(['platoon', 'activity', 'board'] as const).map((k) => (
          <button key={k} type="button" aria-current={tab === k ? 'page' : undefined} onClick={() => go(k)}>
            {t.nav[k]}
          </button>
        ))}
      </nav>
    </div>
  )
}
