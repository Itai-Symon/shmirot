import { useCallback, useEffect, useRef, useState } from 'react'
import { t } from './i18n'
import { DEFAULT_PARAMS, type SoldierId } from './solver/types'
import {
  type ActivitySettings,
  type Plan,
  type SoldierRecord,
  loadPlan,
  loadLastBackup,
  saveLastBackup,
  clearPlan,
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
import { correctHistory, correctLedger, emptyLedger, foldPlan, soldierNow, toHistory, type Ledger } from './ui/ledger'
import { PlatoonScreen } from './ui/PlatoonScreen'
import { defaultSettings } from './ui/defaults'
import { createPlan, minuteAt, replaceInShift, replacementCandidates, replan, toggleHome } from './ui/planner'
import { solveInWorker } from './ui/solverClient'
import { useOfflineStatus } from './ui/offline'
import { BackupCard } from './ui/BackupCard'
import { WelcomeTour } from './ui/Onboarding'
import type { BackupFile } from './storage/backup'
import { defaultRoles, type RoleRecord } from './ui/labels'

type Tab = 'platoon' | 'activity' | 'board'

export default function App() {
  const [ready, setReady] = useState(false)
  const offline = useOfflineStatus()
  const [tourOpen, setTourOpen] = useState(false)
  const [tab, setTab] = useState<Tab>('platoon')
  const [soldiers, setSoldiers] = useState<SoldierRecord[]>([])
  const [settings, setSettings] = useState<ActivitySettings>(() => defaultSettings(Date.now()))
  const [plan, setPlan] = useState<Plan | undefined>()
  const [roles, setRoles] = useState<RoleRecord[]>(defaultRoles)
  const [lastBackup, setLastBackup] = useState<number | undefined>()
  const [preview, setPreview] = useState<Plan | null>(null)
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
    Promise.all([loadSoldiers(), loadSettings(), loadPlan(), loadRoles(), loadLastBackup()])
      .then(([s, st, p, rl, lb]) => {
        setLastBackup(lb)
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
          if (seq === previewSeq.current) setPreview(typeof r === 'string' ? null : r)
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

  /** Replace everything with a validated backup. */
  const restore = (b: BackupFile) => {
    updateSoldiers(b.soldiers)
    setRoles(b.roles)
    void saveRoles(b.roles)
    if (b.settings) updateSettings(b.settings)
    if (b.plan) updatePlan(b.plan)
    else {
      setPlan(undefined)
      void clearPlan()
    }
  }

  /** Correct a soldier's actual guard hours; the current board re-plans from now. */
  const correctHours = async (id: SoldierId, shown: { day: number; night: number; rest: number; home: number }, actual: { day: number; night: number; home: number }) => {
    const alpha = settings.nightWeight ?? DEFAULT_PARAMS.nightWeight
    const old = soldiers.find((s) => s.id === id)?.ledger ?? emptyLedger()
    const fixed = correctLedger(old, shown, actual, alpha)
    updateSoldiers(soldiers.map((s) => (s.id === id ? { ...s, ledger: fixed } : s)))
    if (plan && !busy.current) {
      busy.current = true
      try {
        const dFair = {
          all: fixed.fairShare - old.fairShare,
          day: (fixed.dayFairShare ?? 0) - (old.dayFairShare ?? 0),
          night: (fixed.nightFairShare ?? 0) - (old.nightFairShare ?? 0),
        }
        const pa = plan.settings.nightWeight ?? DEFAULT_PARAMS.nightWeight
        const next = { ...plan, history: correctHistory(plan.history, id, actual.day - shown.day, actual.night - shown.night, pa, dFair) }
        updatePlan(await replan(next, soldiers, next.absences, minuteAt(next, Date.now()), solveInWorker))
      } catch {
        toast(t.board.solverError)
      } finally {
        busy.current = false
      }
    }
    toast(t.platoon.corrected)
  }

  /** A soldier did not show up for a running shift: put someone else in, re-plan from now. */
  const onReplace = async (shiftId: string, oldId: SoldierId, newId: SoldierId) => {
    if (!plan || busy.current) return
    busy.current = true
    try {
      updatePlan(await replaceInShift(plan, soldiers, shiftId, oldId, newId, minuteAt(plan, Date.now()), solveInWorker))
      const name = (id: SoldierId) => soldiers.find((s) => s.id === id)?.name ?? ''
      toast(t.board.replaced(name(oldId), name(newId)))
    } catch {
      toast(t.board.solverError)
    } finally {
      busy.current = false
    }
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
        <div className="topbar">
          <p className={`offline-status ${offline}`} role="status">
            {offline === 'ready' ? '✓ ' : ''}
            {t.offline[offline]}
          </p>
          <button type="button" className="link help-btn" onClick={() => setTourOpen(true)}>
            {t.tour.help}
          </button>
        </div>
        <WelcomeTour forceOpen={tourOpen} onClosed={() => setTourOpen(false)} />
        {!ready ? null : tab === 'platoon' ? (
          <PlatoonScreen
            onCorrect={(id, shown, actual) => void correctHours(id, shown, actual)}
            backup={
              <BackupCard
                data={() => ({ soldiers, roles, settings, plan: plan ?? null })}
                lastBackupMs={lastBackup}
                onSaved={(ms) => {
                  setLastBackup(ms)
                  void saveLastBackup(ms)
                }}
                onRestore={restore}
                toast={toast}
              />
            }
            plan={plan} onResetLoad={resetLoad} soldiers={soldiers} onChange={updateSoldiers} roles={roles} onRolesChange={updateRoles} onNext={() => go('activity')} toast={toast} />
        ) : tab === 'activity' ? (
          <ActivityScreen soldiers={soldiers} preview={preview} previewBusy={previewBusy} roles={roles} settings={settings} onChange={updateSettings} onCreate={() => void create()} />
        ) : (
          <BoardScreen
            plan={plan}
            soldiers={soldiers}
            onToggleHome={(id, ms) => void onToggleHome(id, ms)}
            candidates={(shiftId, oldId) =>
              plan
                ? replacementCandidates(plan, soldiers, shiftId, oldId, minuteAt(plan, Date.now()), (s) => soldierNow(s.id, s.ledger, plan, Date.now()).loadIndex)
                : []
            }
            onReplace={(shiftId, oldId, newId) => void onReplace(shiftId, oldId, newId)}
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
