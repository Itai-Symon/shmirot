import { useState } from 'react'
import { t } from '../i18n'
import type { Role } from '../solver/types'
import type { ActivitySettings, Plan, SoldierRecord } from '../storage/db'
import { BoardScore } from './BoardScore'
import { addWallHours, type PostConfig } from '../storage/shiftGenerator'
import { LABEL_MAX, cleanLabel, type RoleRecord } from './labels'
import { FairnessPanel } from './FairnessPanel'
import { NIGHT_WEIGHT_MAX, NIGHT_WEIGHT_MIN, NIGHT_WEIGHT_STEP, PRESETS, presetOf } from './fairness'
import { DEFAULT_PARAMS } from '../solver/types'

const POST_WEIGHTS = [
  { id: 'easy', value: 0.8 },
  { id: 'normal', value: 1 },
  { id: 'hard', value: 1.3 },
] as const
import { DURATION_HOURS, defaultPost, deviceTimeZone } from './defaults'
import { Chips, DurationField, HourSelect, Stepper, Toggle } from './widgets'

export function ActivityScreen(props: {
  settings: ActivitySettings
  onChange: (s: ActivitySettings) => void
  hasPlan: boolean
  onCreate: () => void
  roles: RoleRecord[]
  preview: Plan | null
  soldiers: SoldierRecord[]
  previewBusy: boolean
}) {
  const roles = props.roles
  const { settings: s, onChange } = props
  const [confirm, setConfirm] = useState(false)
  const set = (patch: Partial<ActivitySettings>) => onChange({ ...s, ...patch })

  const setStart = (start: string) => {
    if (!start) return
    set({ start, timeZone: deviceTimeZone(), end: s.durationHours ? addWallHours(start, s.durationHours) : s.end })
  }
  const setDuration = (h: number) => set({ durationHours: h, end: addWallHours(s.start, h) })
  const setEnd = (end: string) => end && set({ end, durationHours: null })

  const setPosts = (posts: PostConfig[]) => set({ posts })
  const setPostCount = (n: number) => {
    const next = n > s.posts.length ? [...s.posts, ...Array.from({ length: n - s.posts.length }, defaultPost)] : s.posts.slice(0, n)
    // Difficulty only compares posts; with a single post it would just scale everyone equally.
    setPosts(next.length === 1 ? next.map(({ weight: _w, ...p }) => p) : next)
  }
  const patchPost = (i: number, patch: Partial<PostConfig>) =>
    setPosts(s.posts.map((p, j) => (j === i ? { ...p, ...patch } : p)))
  const setReq = (i: number, role: Role, n: number) =>
    patchPost(i, { requirements: { ...s.posts[i].requirements, [role]: n } })

  const nightWeight = s.nightWeight ?? DEFAULT_PARAMS.nightWeight
  const preset = presetOf(nightWeight)

  const create = () => {
    if (props.hasPlan && !confirm) {
      setConfirm(true)
      return
    }
    setConfirm(false)
    props.onCreate()
  }

  return (
    <section className="screen">
      <h1>{t.activity.title}</h1>

      <div className="card">
        <label className="field">
          <span>{t.activity.start}</span>
          <input type="datetime-local" step={900} value={s.start} onChange={(e) => setStart(e.target.value)} />
        </label>
        <div className="field">
          <span>{t.activity.duration}</span>
          <Chips options={DURATION_HOURS} value={s.durationHours} label={t.activity.durationHours} onChange={setDuration} />
        </div>
        <label className="field">
          <span>{t.activity.end}</span>
          <input type="datetime-local" step={900} value={s.end} onChange={(e) => setEnd(e.target.value)} />
        </label>
      </div>

      <div className="card">
        <div className="field">
          <span>{t.activity.shiftLength}</span>
          <DurationField value={s.shiftMinutes} label={t.activity.shiftLength} onChange={(m) => set({ shiftMinutes: m })} />
        </div>
        <div className="field">
          <span>{t.activity.rest}</span>
          <DurationField value={s.restMinutes} label={t.activity.rest} min={0} max={24 * 60} onChange={(m) => set({ restMinutes: m })} />
        </div>
        <Toggle
          checked={s.split !== null}
          hint={t.activity.splitHint}
          onChange={(on) => set({ split: on ? { fromHour: 22, toHour: 6, nightShiftMinutes: 120 } : null })}
        >
          {t.activity.split}
        </Toggle>
        {s.split && (
          <div className="indent">
            <div className="field">
              <span>{t.activity.nightShiftLength}</span>
              <DurationField
                value={s.split.nightShiftMinutes}
                label={t.activity.nightShiftLength}
                onChange={(m) => set({ split: { ...s.split!, nightShiftMinutes: m } })}
              />
            </div>
            <div className="inline">
              <span>{t.activity.nightFrom}</span>
              <HourSelect
                label={t.activity.nightFrom}
                value={s.split.fromHour}
                onChange={(h) => set({ split: { ...s.split!, fromHour: h } })}
              />
              <span>{t.activity.nightTo}</span>
              <HourSelect
                label={t.activity.nightTo}
                value={s.split.toHour}
                onChange={(h) => set({ split: { ...s.split!, toHour: h } })}
              />
            </div>
          </div>
        )}
      </div>

      <div className="row-between">
        <h2>{t.activity.posts}</h2>
        <Stepper value={s.posts.length} min={1} max={12} onChange={setPostCount} label={t.activity.posts} />
      </div>

      {s.posts.map((p, i) => (
        <div className="card post" key={i}>
          <h3>{p.name?.trim() || t.activity.post(i)}</h3>
          <label className="field">
            <span>{t.activity.postNameLabel}</span>
            <input
              type="text"
              value={p.name ?? ''}
              maxLength={LABEL_MAX}
              placeholder={t.activity.post(i)}
              onChange={(e) => patchPost(i, { name: cleanLabel(e.target.value) })}
            />
            <small className="muted">{t.platoon.privacyHint}</small>
          </label>
          <small className="muted">{t.activity.perShift}</small>
          <div className="roles-grid">
            {roles.map(({ id: r, name }) => (
              <div key={r} className={(p.requirements[r] ?? 0) > 0 ? 'role-cell on' : 'role-cell'}>
                <span>{name}</span>
                <Stepper value={p.requirements[r] ?? 0} max={9} onChange={(n) => setReq(i, r, n)} label={name} />
              </div>
            ))}
          </div>
          {s.posts.length > 1 && (
          <div className="field post-weight">
            <span>{t.activity.postWeight(String(p.weight ?? 1))}</span>
            <Chips
              options={POST_WEIGHTS.map((w) => w.value)}
              value={POST_WEIGHTS.some((w) => w.value === (p.weight ?? 1)) ? (p.weight ?? 1) : null}
              label={(v) => t.activity.postWeightPresets[POST_WEIGHTS.find((w) => w.value === v)!.id]}
              onChange={(v) => patchPost(i, { weight: v })}
            />
            <div className="range-row">
              <small>פי 0.5</small>
              <input
                type="range"
                min={0.5}
                max={2}
                step={0.1}
                value={p.weight ?? 1}
                aria-label={t.activity.postWeight(String(p.weight ?? 1))}
                onChange={(e) => patchPost(i, { weight: Math.round(Number(e.target.value) * 10) / 10 })}
              />
              <small>פי 2</small>
            </div>
          </div>
          )}
          <Toggle
            checked={p.activeWindow !== null}
            onChange={(on) => patchPost(i, { activeWindow: on ? { fromHour: 20, toHour: 6 } : null })}
          >
            {t.activity.activeOnly}
          </Toggle>
          {p.activeWindow && (
            <div className="inline indent">
              <span>{t.activity.from}</span>
              <HourSelect
                label={t.activity.from}
                value={p.activeWindow.fromHour}
                onChange={(h) => patchPost(i, { activeWindow: { ...p.activeWindow!, fromHour: h } })}
              />
              <span>{t.activity.to}</span>
              <HourSelect
                label={t.activity.to}
                value={p.activeWindow.toHour}
                onChange={(h) => patchPost(i, { activeWindow: { ...p.activeWindow!, toHour: h } })}
              />
            </div>
          )}
          <Toggle
            checked={!!p.night}
            hint={t.activity.nightStaffHint}
            onChange={(on) => patchPost(i, { night: on ? { fromHour: 22, toHour: 6, requirements: { ...p.requirements } } : null })}
          >
            {t.activity.nightStaff}
          </Toggle>
          {p.night && (
            <div className="indent">
              <div className="inline">
                <span>{t.activity.from}</span>
                <HourSelect label={t.activity.from} value={p.night.fromHour} onChange={(h) => patchPost(i, { night: { ...p.night!, fromHour: h } })} />
                <span>{t.activity.to}</span>
                <HourSelect label={t.activity.to} value={p.night.toHour} onChange={(h) => patchPost(i, { night: { ...p.night!, toHour: h } })} />
              </div>
              <div className="roles-grid">
                {roles.map(({ id: r, name }) => (
                  <div key={r} className={(p.night!.requirements[r] ?? 0) > 0 ? 'role-cell on' : 'role-cell'}>
                    <span>{name}</span>
                    <Stepper
                      value={p.night!.requirements[r] ?? 0}
                      max={9}
                      label={name}
                      onChange={(n) => {
                        const req = { ...p.night!.requirements }
                        if (n > 0) req[r] = n
                        else delete req[r]
                        patchPost(i, { night: { ...p.night!, requirements: req } })
                      }}
                    />
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      ))}

      <div className="card">
        <h2>{t.fairness.title}</h2>
        <div className="field">
          <span>{t.fairness.balanceLabel}</span>
          <div className="segmented small" role="tablist">
            <button type="button" role="tab" aria-selected={s.balance !== 'separate'} onClick={() => set({ balance: 'weighted' })}>
              {t.fairness.balanceWeighted}
            </button>
            <button type="button" role="tab" aria-selected={s.balance === 'separate'} onClick={() => set({ balance: 'separate' })}>
              {t.fairness.balanceSeparate}
            </button>
          </div>
          <small className="muted">{s.balance === 'separate' ? t.fairness.balanceSeparateHint : t.fairness.balanceWeightedHint}</small>
        </div>
        {s.balance !== 'separate' && (<>
        <Chips
          options={PRESETS.map((p) => p.id)}
          value={preset}
          label={(id) => t.fairness.presets[id]}
          onChange={(id) => set({ nightWeight: PRESETS.find((p) => p.id === id)!.nightWeight })}
        />
        {preset && <small className="muted">{t.fairness.presetHints[preset]}</small>}
        <label className="field">
          <span>{t.fairness.nightWeight(String(nightWeight))}</span>
          <div className="range-row">
            <small>×{NIGHT_WEIGHT_MIN}</small>
            <input
              type="range"
              min={NIGHT_WEIGHT_MIN}
              max={NIGHT_WEIGHT_MAX}
              step={NIGHT_WEIGHT_STEP}
              value={nightWeight}
              onChange={(e) => set({ nightWeight: Number(e.target.value) })}
            />
            <small>×{NIGHT_WEIGHT_MAX}</small>
          </div>
        </label>
        </>)}
        <h3>{t.fairness.preview}</h3>
        <FairnessPanel output={props.preview?.output ?? null} busy={props.previewBusy} roles={roles} restMinutes={s.restMinutes} />
        {props.preview && <BoardScore plan={props.preview} soldiers={props.soldiers} />}
      </div>

      <div className="sticky-action">
        {confirm && <p className="warn center">{t.activity.recreateConfirm}</p>}
        <button type="button" className="btn primary big" onClick={create} onBlur={() => setConfirm(false)}>
          {props.hasPlan ? t.activity.recreate : t.activity.create}
        </button>
      </div>
    </section>
  )
}
