import { useState, type ReactNode } from 'react';
import { api } from '../api';
import { useStore } from '../store';
import { closedHow, closerOf, decisionCounts, type Decision, type DecisionCloser } from '../../../shared/decisions';
import { ago } from '../../../shared/usage';
import { useMinute } from './Decisions';
import { go } from './goTo';
import { Icon } from './Icon';

// The decision log (#208), under the approvals: the last week's closed questions, each with its answer, how it closed
// (an option, a reply to a message you can jump to, a re-ask, the CEO, an action with its issue, dropped), when, and
// Reopen; over them a bar of what's open and who closed the rest this week.

const SHOWN = 5;
const WHO: Record<DecisionCloser, { label: string; cls: string }> = {
  you: { label: 'answered by you', cls: 'decision-log-you' },
  ceo: { label: 'resolved by the CEO', cls: 'decision-log-ceo' },
  auto: { label: 'auto-closed', cls: 'decision-log-auto' },
};
/** api() already toasted a failure. */
const attempt = (fn: () => Promise<unknown>) => fn().catch(() => undefined);

function Entry({ d, now }: { d: Decision; now: number }) {
  const repos = useStore((s) => s.repos);
  const how = closedHow(d);
  const link = how.link?.kind === 'issue' ? how.link : null;
  const repo = link && repos.find((r) => r.id === link.repoId);
  const issueUrl = link && repo ? `${repo.url}/issues/${link.number}` : null;
  const reopenable = d.kind === 'suggestion' || d.kind === 'question';
  return (
    <li className={`decision-log-entry ${WHO[closerOf(d)].cls}`}>
      <div className="decision-log-q">{d.question}</div>
      {d.outcome && <div className="decision-log-a small">“{d.outcome}”</div>}
      <div className="decision-log-how small muted">
        {how.messageId !== undefined ? (
          <button type="button" className="decision-log-link" onClick={() => go({ kind: 'ceo', jump: how.messageId })}>
            <Icon name="redo-2" /> {how.text}
          </button>
        ) : issueUrl ? (
          <a className="decision-log-link" href={issueUrl} target="_blank" rel="noopener noreferrer">
            <Icon name="external-link" /> {how.text}
          </a>
        ) : (
          <span>{how.text}</span>
        )}
        <span>· {ago(d.closedAt ?? now, now)}</span>
        {reopenable && (
          <button type="button" className="btn btn-small btn-ghost decision-log-reopen" onClick={() => void attempt(() => api.decideOpen(d.id, 'reopen'))} aria-label={`Reopen “${d.question}”`}>
            Reopen
          </button>
        )}
      </div>
    </li>
  );
}

export function DecisionLog({ heading }: { heading: (text: string) => ReactNode }) {
  const all = useStore((s) => s.decisions);
  const now = useMinute();
  const [more, setMore] = useState(false);
  const closed = all.filter((d) => d.status !== 'open').sort((a, b) => (b.closedAt ?? 0) - (a.closedAt ?? 0));
  if (!closed.length) return null;
  const c = decisionCounts(all, now);
  const total = Math.max(1, c.open + c.you + c.ceo + c.auto);
  const parts: [string, number, string][] = [
    ['open', c.open, 'decision-log-open'],
    [WHO.you.label, c.you, WHO.you.cls],
    [WHO.ceo.label, c.ceo, WHO.ceo.cls],
    [WHO.auto.label, c.auto, WHO.auto.cls],
  ];
  return (
    <section className="decision-log" aria-label="Decision log">
      {heading('Decision log')}
      <div className="decision-log-bar" role="img" aria-label={parts.map(([l, n]) => `${n} ${l}`).join(', ')}>
        {parts.map(([l, n, cls]) => n > 0 && <i key={l} className={cls} style={{ flexGrow: n / total }} />)}
      </div>
      <p className="decision-log-counts small muted">
        {parts.map(([l, n]) => `${n} ${l}`).join(' · ')} <span>this week</span>
      </p>
      <ul className="decision-log-list">
        {(more ? closed : closed.slice(0, SHOWN)).map((d) => (
          <Entry key={d.id} d={d} now={now} />
        ))}
      </ul>
      {closed.length > SHOWN && (
        <button type="button" className="btn btn-small btn-ghost" onClick={() => setMore((m) => !m)}>
          {more ? 'Show fewer' : `Show all ${closed.length}`}
        </button>
      )}
    </section>
  );
}
