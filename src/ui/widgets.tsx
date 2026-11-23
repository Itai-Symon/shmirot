import { formatDuration, parseDuration, snap } from './duration'
import { type ReactNode, useState } from 'react'

export function Chips<T extends string | number>(props: {
  options: readonly T[]
  value: T | null
  label: (v: T) => string
  onChange: (v: T) => void
}) {
  return (
    <div className="chips" role="radiogroup">
      {props.options.map((o) => (
        <button
          key={String(o)}
          type="button"
          role="radio"
          aria-checked={props.value === o}
          className={props.value === o ? 'chip on' : 'chip'}
          onClick={() => props.onChange(o)}
        >
          {props.label(o)}
        </button>
      ))}
    </div>
  )
}

export function Stepper(props: {
  value: number
  min?: number
  max?: number
  onChange: (v: number) => void
  label?: string
}) {
  const min = props.min ?? 0
  const max = props.max ?? 99
  return (
    <div className="stepper" aria-label={props.label}>
      <button type="button" aria-label="+" disabled={props.value >= max} onClick={() => props.onChange(props.value + 1)}>
        +
      </button>
      <span className="stepper-value">{props.value}</span>
      <button type="button" aria-label="−" disabled={props.value <= min} onClick={() => props.onChange(props.value - 1)}>
        −
      </button>
    </div>
  )
}

export function Toggle(props: { checked: boolean; onChange: (v: boolean) => void; children: ReactNode; hint?: string }) {
  return (
    <label className="toggle">
      <input type="checkbox" checked={props.checked} onChange={(e) => props.onChange(e.target.checked)} />
      <span className="toggle-track" aria-hidden />
      <span>
        {props.children}
        {props.hint && <small className="muted"> · {props.hint}</small>}
      </span>
    </label>
  )
}

const HOURS = Array.from({ length: 24 }, (_, h) => h)
export function HourSelect(props: { value: number; onChange: (h: number) => void; label: string }) {
  return (
    <select aria-label={props.label} value={props.value} onChange={(e) => props.onChange(Number(e.target.value))}>
      {HOURS.map((h) => (
        <option key={h} value={h}>
          {String(h).padStart(2, '0')}:00
        </option>
      ))}
    </select>
  )
}

export function Sheet(props: { onClose: () => void; children: ReactNode }) {
  return (
    <div className="sheet-backdrop" onClick={props.onClose}>
      <div className="sheet" role="dialog" onClick={(e) => e.stopPropagation()}>
        {props.children}
      </div>
    </div>
  )
}

/**
 * One field for a length of time: − / + in 15-minute steps, and the value itself can be typed
 * ("2:30", "2.5", "150").
 */
export function DurationField(props: {
  value: number
  onChange: (minutes: number) => void
  label: string
  min?: number
  max?: number
  step?: number
}) {
  const min = props.min ?? 15
  const max = props.max ?? 12 * 60
  const step = props.step ?? 15
  const [text, setText] = useState<string | null>(null)
  const commit = () => {
    if (text === null) return
    const v = parseDuration(text)
    if (v !== null) props.onChange(snap(v, step, min, max))
    setText(null)
  }
  return (
    <div className="duration">
      <button type="button" aria-label="+" disabled={props.value >= max} onClick={() => props.onChange(snap(props.value + step, step, min, max))}>
        +
      </button>
      <input
        type="text"
        inputMode="decimal"
        aria-label={props.label}
        value={text ?? formatDuration(props.value)}
        onFocus={(e) => {
          setText(formatDuration(props.value))
          e.currentTarget.select()
        }}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
      />
      <span className="duration-unit">ש׳</span>
      <button type="button" aria-label="−" disabled={props.value <= min} onClick={() => props.onChange(snap(props.value - step, step, min, max))}>
        −
      </button>
    </div>
  )
}
