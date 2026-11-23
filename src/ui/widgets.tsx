import type { ReactNode } from 'react'

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

/** Hour chips plus a free minutes field (15-minute steps). */
export function MinutesPicker(props: {
  value: number
  hours: readonly number[]
  label: (h: number) => string
  minutesLabel: string
  onChange: (minutes: number) => void
  min?: number
  max?: number
}) {
  const min = props.min ?? 15
  const max = props.max ?? 12 * 60
  const chip = props.hours.find((h) => h * 60 === props.value) ?? null
  return (
    <div className="minutes-picker">
      <Chips options={props.hours} value={chip} label={props.label} onChange={(h) => props.onChange(h * 60)} />
      <label className="inline">
        <span className="muted">{props.minutesLabel}</span>
        <input
          type="number"
          inputMode="numeric"
          min={min}
          max={max}
          step={15}
          value={props.value}
          onChange={(e) => {
            const v = Math.round(Number(e.target.value))
            if (Number.isFinite(v) && v >= min && v <= max) props.onChange(v)
          }}
        />
      </label>
    </div>
  )
}
