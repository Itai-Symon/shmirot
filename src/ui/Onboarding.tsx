import { useState } from 'react'
import { t } from '../i18n'
import { markSeen, needsIosInstall, useTip, type TipId } from './onboarding'
import { Sheet } from './widgets'

/** Welcome tour on the first open (or when replayed from the help button). */
export function WelcomeTour(props: { forceOpen: boolean; onClosed: () => void }) {
  const first = useTip('welcome')
  const [step, setStep] = useState(0)
  if (!first && !props.forceOpen) return null
  const steps = t.tour.steps
  const last = step === steps.length - 1
  const close = () => {
    void markSeen('welcome')
    setStep(0)
    props.onClosed()
  }
  return (
    <Sheet onClose={close}>
      <div className="tour">
        <h2>{steps[step].title}</h2>
        <p>{steps[step].body}</p>
        {step === 0 && needsIosInstall() && <p className="notice warn">{t.tour.iosInstall}</p>}
        <div className="tour-dots" aria-hidden>
          {steps.map((_, i) => (
            <span key={i} className={i === step ? 'on' : ''} />
          ))}
        </div>
        <div className="tour-actions">
          <button type="button" className="btn primary" onClick={() => (last ? close() : setStep(step + 1))}>
            {last ? t.tour.start : t.tour.next}
          </button>
          {step > 0 ? (
            <button type="button" className="btn" onClick={() => setStep(step - 1)}>
              {t.tour.back}
            </button>
          ) : (
            <button type="button" className="link" onClick={close}>
              {t.tour.skip}
            </button>
          )}
        </div>
      </div>
    </Sheet>
  )
}

/** A one-time explanation at the top of a screen, after the welcome tour was seen. */
export function ScreenTip(props: { id: Exclude<TipId, 'welcome'> }) {
  const show = useTip(props.id)
  const tourPending = useTip('welcome')
  if (!show || tourPending) return null
  return (
    <div className="screen-tip" role="note">
      <span aria-hidden>💡</span>
      <p>{t.tips[props.id]}</p>
      <button type="button" className="btn" onClick={() => void markSeen(props.id)}>
        {t.tips.ok}
      </button>
    </div>
  )
}
