import { t } from '../i18n'
import { isInstalled, markSeen, useTip } from './onboarding'
import { Sheet } from './widgets'

/** One popup on the first open (and from the help button): how to install, and the order. */
export function WelcomeTour(props: { forceOpen: boolean; onClosed: () => void }) {
  const first = useTip('welcome')
  if (!first && !props.forceOpen) return null
  const close = () => {
    void markSeen('welcome')
    props.onClosed()
  }
  return (
    <Sheet onClose={close}>
      <div className="tour">
        <h2>{t.tour.title}</h2>
        <h3>{t.tour.installTitle}</h3>
        {isInstalled() ? (
          <p className="good">{t.tour.installed}</p>
        ) : (
          <ul className="tour-list">
            <li>{t.tour.installIos}</li>
            <li>{t.tour.installAndroid}</li>
          </ul>
        )}
        <p className="muted">{t.tour.installAfter}</p>
        <h3>{t.tour.orderTitle}</h3>
        <ol className="tour-list">
          {t.tour.order.map((x) => (
            <li key={x}>{x}</li>
          ))}
        </ol>
        <button type="button" className="btn primary big" onClick={close}>
          {t.tour.start}
        </button>
      </div>
    </Sheet>
  )
}
