// Mission control → Your changes (#207): the manager's board actions today, how many touched running work, and what
// the CEO did about those (stopped, redirected, let finish), as one small stacked bar. Tapping it lists each change.
import { useState } from 'react';
import { useStore } from '../store';
import { changeStats } from '../../../shared/managerChanges';
import { CEO_ID, type ManagerChange } from '../../../shared/types';
import { ProgressBar } from './ProgressBar';
import { Icon } from './Icon';

const VERDICT: Record<NonNullable<ManagerChange['verdict']>, string> = { stopped: 'stopped', redirected: 'redirected', 'let-finish': 'let finish' };

function verdictOf(c: ManagerChange, ceo: string): string {
  if (!c.affects.length) return 'no running work touched';
  return c.verdict ? `${ceo}: ${VERDICT[c.verdict]}` : c.told ? `${ceo} is deciding` : `${ceo} hears of it in a minute`;
}

export function ManagerChangesCard() {
  const changes = useStore((s) => s.managerChanges);
  const ceo = useStore((s) => s.agents[CEO_ID]?.name) || 'The CEO';
  const [open, setOpen] = useState(false);
  const s = changeStats(changes, Date.now());
  if (!s.today) return null;
  const today = changes.filter((c) => new Date(c.at).toDateString() === new Date().toDateString()).reverse();
  const deciding = s.touched - s.stopped - s.redirected - s.letFinish;
  return (
    <div className="card office-card" id="ops-card-changes">
      <ProgressBar
        label={
          <>
            <Icon name="hand" /> Your changes today
          </>
        }
        value={`${s.today} · ${s.touched} touched running work`}
        parts={[
          { key: 'stopped', label: 'Stopped', value: s.stopped },
          { key: 'redirected', label: 'Redirected', value: s.redirected },
          { key: 'finish', label: 'Let finish', value: s.letFinish },
          { key: 'deciding', label: 'Deciding', value: deciding },
        ]}
        note={s.touched ? `${ceo} decides what happens to running work` : 'None touched running work'}
        aria={`Your changes today: ${s.today}, ${s.touched} touched running work; the CEO stopped ${s.stopped}, redirected ${s.redirected}, let ${s.letFinish} finish, ${deciding} undecided`}
        onClick={() => setOpen(!open)}
        expanded={open}
        tap={open ? 'Hide the changes' : 'Show each change'}
      />
      {open && (
        <ul className="mc-changes">
          {today.map((c) => (
            <li key={c.id} className="small">
              <b>Floor {c.floor}</b> · {c.detail}
              <span className="muted"> · {new Date(c.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} · {verdictOf(c, ceo)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
