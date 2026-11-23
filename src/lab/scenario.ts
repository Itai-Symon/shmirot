/** Lab scenarios: a few numbers → a real SolverInput built with the real shift generator. */
import type { BalanceMode, Soldier, SolverInput } from '../solver/types'
import { generateShifts, type PostConfig } from '../storage/shiftGenerator'

export interface Scenario {
  title: string
  soldiers: number
  commanders: number
  days: number
  posts: { people: number; commander: boolean; weight: number; nightOnly: boolean }[]
  shiftMinutes: number
  splitNight: boolean
  nightShiftMinutes: number
  restMinutes: number
  nightWeight: number
  homeRotation: boolean
}

export const PRESETS: Scenario[] = [
  { title: 'יממה, עמדה אחת, 5 חיילים', soldiers: 5, commanders: 0, days: 1, posts: [{ people: 1, commander: false, weight: 1, nightOnly: false }], shiftMinutes: 120, splitNight: false, nightShiftMinutes: 120, restMinutes: 240, nightWeight: 1.5, homeRotation: false },
  { title: 'שבוע, עמדה אחת, 7 חיילים', soldiers: 7, commanders: 0, days: 7, posts: [{ people: 1, commander: false, weight: 1, nightOnly: false }], shiftMinutes: 120, splitNight: false, nightShiftMinutes: 120, restMinutes: 240, nightWeight: 1.5, homeRotation: false },
  { title: 'שבוע, 3 עמדות, יום/לילה, 12 חיילים', soldiers: 12, commanders: 2, days: 7, posts: [{ people: 2, commander: true, weight: 1.3, nightOnly: false }, { people: 1, commander: false, weight: 1, nightOnly: false }, { people: 1, commander: false, weight: 0.8, nightOnly: true }], shiftMinutes: 240, splitNight: true, nightShiftMinutes: 120, restMinutes: 240, nightWeight: 1.5, homeRotation: false },
  { title: 'חודש: 30 חיילים, 5 עמדות, יציאות הביתה (כמו טסט החודש)', soldiers: 30, commanders: 4, days: 30, posts: [{ people: 2, commander: true, weight: 1.3, nightOnly: false }, { people: 2, commander: false, weight: 1, nightOnly: false }, { people: 1, commander: false, weight: 1, nightOnly: true }, { people: 1, commander: false, weight: 0.8, nightOnly: false }, { people: 1, commander: false, weight: 1, nightOnly: false }], shiftMinutes: 240, splitNight: true, nightShiftMinutes: 120, restMinutes: 240, nightWeight: 1.5, homeRotation: true },
  { title: 'מלכודת לילות: 3 חיילים, משמרות של שעתיים', soldiers: 3, commanders: 0, days: 3, posts: [{ people: 1, commander: false, weight: 1, nightOnly: false }], shiftMinutes: 120, splitNight: false, nightShiftMinutes: 120, restMinutes: 240, nightWeight: 1.5, homeRotation: false },
]

const DAY = 24 * 60

export function buildInput(sc: Scenario, balance: BalanceMode): SolverInput {
  const end = new Date(Date.UTC(2026, 11, 1 + sc.days)).toISOString().slice(0, 10)
  const posts: PostConfig[] = sc.posts.map((p) => ({
    requirements: p.commander ? { commander: 1, ...(p.people > 1 && { soldier: p.people - 1 }) } : { soldier: p.people },
    activeWindow: p.nightOnly ? { fromHour: 20, toHour: 6 } : null,
    weight: p.weight,
  }))
  const g = generateShifts({
    start: '2026-12-01T20:00',
    end: `${end}T20:00`,
    timeZone: 'Asia/Jerusalem',
    shiftMinutes: sc.shiftMinutes,
    split: sc.splitNight ? { fromHour: 22, toHour: 6, nightShiftMinutes: sc.nightShiftMinutes } : null,
    posts,
  })
  const soldiers: Soldier[] = Array.from({ length: sc.soldiers }, (_, i) => {
    const absences = []
    if (sc.homeRotation) for (let d = 2 + (i % 3) * 3; d < sc.days; d += 10) absences.push({ start: d * DAY, end: (d + 2) * DAY })
    return { id: `s${String(i + 1).padStart(2, '0')}`, roles: i < sc.commanders ? ['commander', 'soldier'] : ['soldier'], absences }
  })
  return { soldiers, shifts: g.shifts, params: { minRestMinutes: sc.restMinutes, nightWeight: sc.nightWeight, balance }, locked: [] }
}

export const soldierName = (id: string) => `חייל ${Number(id.slice(1))}`
