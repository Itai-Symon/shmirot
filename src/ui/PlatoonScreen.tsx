import { useState } from 'react'
import { t } from '../i18n'
import { ROLES, type Role } from '../solver/types'
import type { SoldierRecord } from '../storage/db'
import { parseNames } from './names'

let idCounter = 0
function newId(): string {
  idCounter += 1
  return `s${Date.now().toString(36)}${idCounter.toString(36)}`
}

export function PlatoonScreen(props: {
  soldiers: SoldierRecord[]
  onChange: (list: SoldierRecord[]) => void
  onNext: () => void
  toast: (msg: string) => void
}) {
  const { soldiers, onChange } = props
  const [text, setText] = useState('')
  const [confirmId, setConfirmId] = useState<string | null>(null)

  const add = () => {
    const existing = new Set(soldiers.map((s) => s.name))
    const names = parseNames(text).filter((n) => !existing.has(n))
    let order = soldiers.reduce((m, s) => Math.max(m, s.order), -1)
    const added = names.map((name) => ({ id: newId(), name, roles: ['soldier'] as Role[], order: ++order }))
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
                <div className="chips small">
                  {ROLES.map((r) => (
                    <button
                      key={r}
                      type="button"
                      aria-pressed={s.roles.includes(r)}
                      className={s.roles.includes(r) ? 'chip on' : 'chip'}
                      onClick={() => toggleRole(s.id, r)}
                    >
                      {t.roles[r]}
                    </button>
                  ))}
                </div>
              </li>
            ))}
          </ul>
          <div className="sticky-action">
            <button type="button" className="btn primary" onClick={props.onNext}>
              {t.platoon.next}
            </button>
          </div>
        </>
      )}
    </section>
  )
}
