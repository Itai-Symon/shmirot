import { useCallback, useEffect, useRef, useState } from 'react'
import { t } from './i18n'
import type { SoldierId } from './solver/types'
import {
  type ActivitySettings,
  type Plan,
  type SoldierRecord,
  loadPlan,
  loadSettings,
  loadSoldiers,
  requestPersistence,
  savePlan,
  saveSettings,
  saveSoldiers,
} from './storage/db'
import { ActivityScreen } from './ui/ActivityScreen'
import { BoardScreen } from './ui/BoardScreen'
import { PlatoonScreen } from './ui/PlatoonScreen'
import { defaultSettings } from './ui/defaults'
import { createPlan, minuteAt, toggleHome } from './ui/planner'
import { solveInWorker } from './ui/solverClient'

type Tab = 'platoon' | 'activity' | 'board'

export default function App() {
  const [ready, setReady] = useState(false)
  const [tab, setTab] = useState<Tab>('platoon')
  const [soldiers, setSoldiers] = useState<SoldierRecord[]>([])
  const [settings, setSettings] = useState<ActivitySettings>(() => defaultSettings(Date.now()))
  const [plan, setPlan] = useState<Plan | undefined>()
  const [toastMsg, setToastMsg] = useState<string | null>(null)
  const toastTimer = useRef<number | undefined>(undefined)

  const toast = useCallback((msg: string) => {
    setToastMsg(msg)
    window.clearTimeout(toastTimer.current)
    toastTimer.current = window.setTimeout(() => setToastMsg(null), 2500)
  }, [])

  useEffect(() => {
    requestPersistence()
    Promise.all([loadSoldiers(), loadSettings(), loadPlan()])
      .then(([s, st, p]) => {
        setSoldiers(s)
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

  const updateSoldiers = (list: SoldierRecord[]) => {
    setSoldiers(list)
    void saveSoldiers(list)
  }
  const updateSettings = (s: ActivitySettings) => {
    setSettings(s)
    void saveSettings(s)
  }
  const updatePlan = (p: Plan) => {
    setPlan(p)
    void savePlan(p)
  }

  const busy = useRef(false)

  const create = async () => {
    if (busy.current) return
    busy.current = true
    let result: Awaited<ReturnType<typeof createPlan>>
    try {
      result = await createPlan(settings, soldiers, solveInWorker)
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
    updatePlan(result)
    setTab('board')
    window.scrollTo(0, 0)
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
          <PlatoonScreen soldiers={soldiers} onChange={updateSoldiers} onNext={() => go('activity')} toast={toast} />
        ) : tab === 'activity' ? (
          <ActivityScreen settings={settings} onChange={updateSettings} hasPlan={!!plan} onCreate={() => void create()} />
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
