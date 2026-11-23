import { describe, expect, it } from 'vitest'
import { solve as solveSync } from '../solver'
import { createPlan } from '../ui/planner'
import { defaultRoles } from '../ui/labels'
import { emptyLedger } from '../ui/ledger'
import { BACKUP_VERSION, backupFileName, makeBackup, parseBackup } from './backup'
import type { ActivitySettings, SoldierRecord } from './db'

// Invented names only.
const soldiers: SoldierRecord[] = ['א', 'ב', 'ג', 'ד'].map((name, i) => ({ id: `s${i}`, name, roles: ['soldier'], order: i, ledger: { ...emptyLedger(), dayGuardMinutes: 60 * i } }))
const settings: ActivitySettings = {
  start: '2026-12-01T20:00', end: '2026-12-02T20:00', timeZone: 'Asia/Jerusalem', shiftMinutes: 120, split: null,
  restMinutes: 240, durationHours: 24, posts: [{ name: 'ש״ג', requirements: { soldier: 1 }, activeWindow: null }],
}

describe('backup', () => {
  it('export → import round-trip is lossless', async () => {
    const plan = await createPlan(settings, soldiers, async (i) => solveSync(i))
    if (typeof plan === 'string') throw new Error(plan)
    const file = makeBackup({ soldiers, roles: defaultRoles(), settings, plan }, new Date('2026-12-02T10:00:00Z'))
    const back = parseBackup(JSON.stringify(file))
    expect(back.ok).toBe(true)
    if (!back.ok) return
    expect(back.data.soldiers).toEqual(soldiers)
    expect(back.data.roles).toEqual(defaultRoles())
    expect(back.data.settings).toEqual(settings)
    expect(back.data.plan).toEqual(plan)
    expect(backupFileName(new Date('2026-12-02T10:00:00Z'))).toBe('shmirot-backup-2026-12-02.json')
  })

  it('a backup without a board is valid', () => {
    const file = makeBackup({ soldiers, roles: defaultRoles(), settings: null, plan: null }, new Date())
    expect(parseBackup(JSON.stringify(file)).ok).toBe(true)
  })

  it('rejects anything that is not a whole, valid backup', () => {
    const good = makeBackup({ soldiers, roles: defaultRoles(), settings, plan: null }, new Date())
    const bad = (x: unknown) => parseBackup(typeof x === 'string' ? x : JSON.stringify(x))
    expect(bad('not json')).toEqual({ ok: false, error: 'notJson' })
    expect(bad({ hello: 1 })).toEqual({ ok: false, error: 'notBackup' })
    expect(bad({ ...good, version: BACKUP_VERSION + 1 })).toEqual({ ok: false, error: 'newerVersion' })
    expect(bad({ ...good, soldiers: [{ id: 's1' }] })).toEqual({ ok: false, error: 'broken' })
    expect(bad({ ...good, soldiers: [soldiers[0], soldiers[0]] })).toEqual({ ok: false, error: 'broken' })
    expect(bad({ ...good, roles: [] })).toEqual({ ok: false, error: 'broken' })
    expect(bad({ ...good, plan: { settings } })).toEqual({ ok: false, error: 'broken' })
  })
})
