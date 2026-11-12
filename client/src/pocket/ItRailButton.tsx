// The IT department in pocket mode's menu (#580): the phone's bottom bar and the desktop's left rail, with a badge for
// IT's open cards and the health checks needing a look (ui/itBadge.ts). It opens Settings → The IT department.
import { Icon } from '../ui/Icon';
import { badgeCount } from '../ui/badgeCount';
import { openIt, useItBadge } from '../ui/useItBadge';

export function ItRailButton({ on }: { on: boolean }) {
  const waiting = useItBadge();
  return (
    <button className={`pk-tab ${on ? 'pk-tab-on' : ''}`} aria-current={on ? 'page' : undefined} onClick={openIt} title="The IT department: this machine's health and IT's cards">
      <span className="pk-tab-icon">
        <Icon name="wrench" />
        {waiting > 0 && (
          <span className="badge badge-dot" role="img" aria-label={`${waiting} waiting`}>
            {badgeCount(waiting)}
          </span>
        )}
      </span>
      <span className="pk-tab-label">IT</span>
    </button>
  );
}
