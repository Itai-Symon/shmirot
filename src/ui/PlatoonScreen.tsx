import { type ReactNode, useEffect, useState } from 'react'
import { t } from '../i18n'
import type { Role } from '../solver/types'
import type { Plan, SoldierRecord } from '../storage/db'
import { soldierNow } from './ledger'
import { LABEL_MAX, cleanLabel, newRoleId, type RoleRecord } from './labels'
import { parseNames } from './names'

let idCounter = 0
function newId(): string {
  idCounter += 1
  return `s${Date.now().toString(36)}${idCounter.toString(36)}`
}

export function PlatoonScreen(props: {
  backup: ReactNode
  plan: Plan | undefined
  onResetLoad: () => void
  soldiers: SoldierRecord[]
  onChange: (list: SoldierRecord[]) => void
  roles: RoleRecord[]
  onRolesChange: (roles: RoleRecord[]) => void
  onNext: () => void
  toast: (msg: string) => void
}) {
  const { soldiers, onChange } = props
  const [text, setText] = useState('')
  const [confirmId, setConfirmId] = useState<string | null>(null)
  const [newRole, setNewRole] = useState('')
  const [confirmReset, setConfirmReset] = useState(false)
  const [nowMs, setNowMs] = useState(() => Date.now())
  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), 60_000)
    return () => window.clearInterval(timer)
  }, [])
  // Shown on the 15-minute grid (a shift in progress counts up to "now").
  const hm = (raw: number) => {
    const m = Math.round(raw / 15) * 15
    return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`
  }
  const roles = props.roles
  const ROLES = roles.map((r) => r.id)
  const defaultRole = roles.some((r) => r.id === 'soldier') ? 'soldier' : roles[0]?.id

  const renameRole = (id: Role, raw: string) =>
    props.onRolesChange(roles.map((r) => (r.id === id ? { ...r, name: cleanLabel(raw) } : r)))
  const addRole = () => {
    const name = cleanLabel(newRole).trim()
    if (!name) return
    if (roles.some((r) => r.name.trim() === name)) {
      props.toast(t.platoon.roleExists)
      return
    }
    props.onRolesChange([...roles, { id: newRoleId(), name }])
    setNewRole('')
  }
  const removeRole = (id: Role) => {
    if (roles.length === 1) {
      props.toast(t.platoon.lastRole)
      return
    }
    if (confirmId !== `role:${id}`) {
      setConfirmId(`role:${id}`)
      return
    }
    setConfirmId(null)
    props.onRolesChange(roles.filter((r) => r.id !== id))
  }

  const add = () => {
    const existing = new Set(soldiers.map((s) => s.name))
    const names = parseNames(text).filter((n) => !existing.has(n))
    let order = soldiers.reduce((m, s) => Math.max(m, s.order), -1)
    const added = names.map((name) => ({ id: newId(), name, roles: defaultRole ? [defaultRole] : [], order: ++order }))
    onChange([...soldiers, ...added])
    setText('')
    props.toast(added.length ? t.platoon.addedCount(added.length) : t.platoon.nothingAdded)
  }

  const toggleRole = (id: string, role: Role) => {
    onChange(
      soldiers.map((s) => {
        if (s.id !== id) return s
        const has = s.roles.includes(role)
        if (has && s.roles.length === 1) {
          props.toast(t.platoon.atLeastOneRole)
          return s
        }
        const roles = has ? s.roles.filter((r) => r !== role) : ROLES.filter((r) => r === role || s.roles.includes(r))
        return { ...s, roles }
      }),
    )
  }

  const remove = (id: string) => {
    if (confirmId !== id) {
      setConfirmId(id)
      return
    }
    setConfirmId(null)
    onChange(soldiers.filter((s) => s.id !== id))
  }

  return (
    <section className="screen">
      <h1>{t.platoon.title}</h1>

      <label className="field">
        <span>{t.platoon.pasteLabel}</span>
        <textarea
          rows={soldiers.length ? 3 : 6}
          value={text}
          placeholder={t.platoon.pastePlaceholder}
          onChange={(e) => setText(e.target.value)}
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
        />
      </label>
      <button type="button" className="btn primary" disabled={!text.trim()} onClick={add}>
        {t.platoon.add}
      </button>

      <details className="card roles-editor">
        <summary>
          <strong>{t.platoon.rolesTitle}</strong> <small className="muted">{t.platoon.rolesEditHint}</small>
        </summary>
        <small className="muted">{t.platoon.privacyHint}</small>
        <ul className="role-list">
          {roles.map((r) => (
            <li key={r.id} className="row-between">
              <input
                type="text"
                value={r.name}
                maxLength={LABEL_MAX}
                aria-label={t.platoon.rolesTitle}
                onChange={(e) => renameRole(r.id, e.target.value)}
                onBlur={() => renameRole(r.id, r.name.trim() || '?')}
              />
              <button
                type="button"
                className={confirmId === `role:${r.id}` ? 'link danger' : 'link'}
                onClick={() => removeRole(r.id)}
                onBlur={() => setConfirmId(null)}
              >
                {confirmId === `role:${r.id}` ? t.platoon.removeRoleConfirm : t.platoon.removeRole}
              </button>
            </li>
          ))}
        </ul>
        <div className="inline">
          <input
            type="text"
            value={newRole}
            maxLength={LABEL_MAX}
            placeholder={t.platoon.roleNamePlaceholder}
            onChange={(e) => setNewRole(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && addRole()}
          />
          <button type="button" className="btn" disabled={!newRole.trim()} onClick={addRole}>
            {t.platoon.addRole}
          </button>
        </div>
      </details>

      {soldiers.length === 0 ? (
        <p className="muted center">{t.platoon.empty}</p>
      ) : (
        <>
          <div className="row-between">
            <h2>{t.platoon.count(soldiers.length)}</h2>
            <small className="muted">{t.platoon.rolesHint}</small>
          </div>
          <ul className="soldiers">
            {soldiers.map((s) => (
              <li key={s.id} className="soldier">
                <div className="row-between">
                  <strong>{s.name}</strong>
                  <button
                    type="button"
                    className={confirmId === s.id ? 'link danger' : 'link'}
                    onClick={() => remove(s.id)}
                    onBlur={() => setConfirmId(null)}
                  >
                    {confirmId === s.id ? t.platoon.removeConfirm : t.platoon.remove}
                  </button>
                </div>
                {(() => {
                  const n = soldierNow(s.id, s.ledger, props.plan, nowMs)
                  return (
                    <dl className="soldier-stats">
                      <div><dt>{t.platoon.statDay}</dt><dd>{hm(n.dayGuardMinutes)}</dd></div>
                      <div><dt>{t.platoon.statNight}</dt><dd>{hm(n.nightGuardMinutes)}</dd></div>
                      <div><dt>{t.platoon.statRest}</dt><dd>{hm(n.restMinutes)}</dd></div>
                      <div><dt>{t.platoon.statHome}</dt><dd>{hm(n.homeMinutes)}</dd></div>
                      <div><dt>{t.platoon.statLoad}</dt><dd>{n.loadIndex === null ? '—' : `${Math.round(n.loadIndex * 100)}%`}</dd></div>
                    </dl>
                  )
                })()}
                <div className="chips small">
                  {ROLES.map((r) => (
                    <button
                      key={r}
                      type="button"
                      aria-pressed={s.roles.includes(r)}
                      className={s.roles.includes(r) ? 'chip on' : 'chip'}
                      onClick={() => toggleRole(s.id, r)}
                    >
                      {roles.find((x) => x.id === r)?.name || '?'}
                    </button>
                  ))}
                </div>
              </li>
            ))}
          </ul>
          <p className="muted small-print">{t.platoon.statsHint}</p>
          <p className="muted small-print">
            <a href="./lab.html">{t.platoon.labLink}</a>
          </p>
          <button
            type="button"
            className={confirmReset ? 'btn danger' : 'btn'}
            onBlur={() => setConfirmReset(false)}
            onClick={() => {
              if (!confirmReset) return setConfirmReset(true)
              setConfirmReset(false)
              props.onResetLoad()
            }}
          >
            {confirmReset ? t.platoon.resetLoadConfirm : t.platoon.resetLoad}
          </button>
          <div className="sticky-action">
            <button type="button" className="btn primary" onClick={props.onNext}>
              {t.platoon.next}
            </button>
          </div>
        </>
      )}
      {props.backup}
    </section>
  )
}
