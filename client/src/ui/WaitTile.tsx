import { useStore } from '../store';
import { fmtDuration, waitTile, WAIT_TARGET_MS } from '../ops';
import { Chip, Section } from './DetailsPage';
import { Icon } from './Icon';
import './waitTile.css';

// Mission control's "longest wait in needs-you" tile (#275): the longest a PR has waited for a decision right now
// against the 30-minute target, and the longest per day over the last week.

const DAYS = ['6 d ago', '5 d ago', '4 d ago', '3 d ago', '2 d ago', 'yesterday', 'today'];

export function WaitTile() {
  const total = useStore((s) => s.ops.total);
  const t = waitTile(total);
  return (
    <Section
      id="ops-card-wait"
      className={`wait-tile wait-${t.tone}`}
      title={
        <span className="dp-chips">
          <Icon name="hourglass" /> Longest wait in needs-you <Chip tone={t.tone}>{t.value}</Chip>
        </span>
      }
    >
      <div className="wait-bars" role="img" aria-label={`Longest wait per day over 7 days: ${total.waitTrend.map((ms, i) => `${DAYS[i]} ${ms === null ? 'none' : fmtDuration(ms)}`).join(', ')}`}>
        <span className="wait-target" style={{ bottom: `${t.target * 100}%` }} />
        {t.bars.map((b, i) => (
          <span key={i} className={`wait-bar ${b !== null && b > t.target ? 'wait-bar-over' : ''}`} style={{ height: b === null ? 0 : `${Math.max(4, b * 100)}%` }} title={`${DAYS[i]}: ${total.waitTrend[i] === null ? 'none' : fmtDuration(total.waitTrend[i])}`} />
        ))}
      </div>
      <div className="dp-meta">Target under {fmtDuration(WAIT_TARGET_MS)}. A PR held only by a conflict or a CI outage goes back into the flow by itself; anything else goes back to the CEO every 2 h (Settings → Company).</div>
    </Section>
  );
}
