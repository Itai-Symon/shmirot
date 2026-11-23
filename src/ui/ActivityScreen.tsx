import { useState } from 'react'
import { t } from '../i18n'
import type { Role } from '../solver/types'
import type { ActivitySettings } from '../storage/db'
import { addWallHours, type PostConfig } from '../storage/shiftGenerator'
import { LABEL_MAX, cleanLabel, type RoleRecord } from './labels'
import { FairnessPanel } from './FairnessPanel'
import { NIGHT_WEIGHT_MAX, NIGHT_WEIGHT_MIN, NIGHT_WEIGHT_STEP, PRESETS, presetOf } from './fairness'
import { DEFAULT_PARAMS, type SolverOutput } from '../solver/types'
import { DURATION_HOURS, REST_HOURS, SHIFT_HOURS, defaultPost, deviceTimeZone } from './defaults'
import { Chips, HourSelect, Stepper, Toggle } from './widgets'

export function ActivityScreen(props: {
  settings: ActivitySettings
  onChange: (s: ActivitySettings) => void
  hasPlan: boolean
  onCreate: () => void
  roles: RoleRecord[]
  preview: SolverOutput | null
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
  const setPostCount = (n: number) =>
    setPosts(n > s.posts.length ? [...s.posts, ...Array.from({ length: n - s.posts.length }, defaultPost)] : s.posts.slice(0, n))
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
          <input type="datetime-local" value={s.start} onChange={(e) => setStart(e.target.value)} />
        </label>
        <div className="field">
          <span>{t.activity.duration}</span>
          <Chips options={DURATION_HOURS} value={s.durationHours} label={t.activity.durationHours} onChange={setDuration} />
        </div>
        <label className="field">
          <span>{t.activity.end}</span>
          <input type="datetime-local" value={s.end} onChange={(e) => setEnd(e.target.value)} />
        </label>
      </div>

      <div className="card">
        <div className="field">
          <span>{t.activity.shiftLength}</span>
          <Chips
            options={SHIFT_HOURS}
            value={s.shiftMinutes / 60}
            label={t.activity.hours}
            onChange={(h) => set({ shiftMinutes: h * 60 })}
          />
        </div>
        <div className="field">
          <span>{t.activity.rest}</span>
          <Chips
            options={REST_HOURS}
            value={s.restMinutes / 60}
            label={t.activity.hours}
            onChange={(h) => set({ restMinutes: h * 60 })}
          />
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
              <Chips
                options={SHIFT_HOURS}
                value={s.split.nightShiftMinutes / 60}
                label={t.activity.hours}
                onChange={(h) => set({ split: { ...s.split!, nightShiftMinutes: h * 60 } })}
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
        </div>
      ))}

      <div className="card">
        <h2>{t.fairness.title}</h2>
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
        <h3>{t.fairness.preview}</h3>
        <FairnessPanel output={props.preview} busy={props.previewBusy} roles={roles} restMinutes={s.restMinutes} />
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
