// Mission control's cloud line (#260): today's cloud agents Hybrid added because this computer was full, and the Box
// hours cloud agents' sessions ran, with about what they cost. Shown once there's any.
import { fmtUsd } from '../ops';
import { useStore } from '../store';
import { Icon } from './Icon';

export function CloudToday() {
  const c = useStore((s) => s.ops.cloud);
  if (!c) return null;
  return (
    <div className="card office-card" id="ops-card-cloud">
      <div className="row wrap">
        <span className="floor-badge office-badge" aria-hidden>
          <Icon name="cloud" />
        </span>
        <div className="grow">
          <b>Cloud today</b>
          <div className="small">
            {c.bursts} added for load · {c.boxHours.toFixed(1)} Box hours · ~{fmtUsd(c.boxUsd)}
          </div>
          <div className="muted small">Box cost is an estimate: session time at your Box size's price per CPU hour.</div>
        </div>
      </div>
    </div>
  );
}
