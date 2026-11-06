import { useEffect, useState } from 'react';
import { useStore } from '../store';
import type { ChatAction } from '../../../shared/ceoActions';
import { currentStep } from '../../../shared/ceoStream';
import { CEO_ID, type ChatIdea } from '../../../shared/types';
import { actionStatus, daySeparator, elapsed, starterChips, workingLine, type ActionStatus } from './chatCardRules';
import { useRefOpen } from './RefChips';
import './chatCards.css';

// The CEO chat's cards (#108): what a reply did as action cards with a live status, its idea card (Accept / Edit /
// Not now), the "working on it" strip with Stop, and the starter chips of an empty message box. Rules in chatCardRules.ts.

/** One office tool call that changed something; its status follows the issue, PR, floor or agent it names. */
function ActionCard({ action }: { action: ChatAction }) {
  const world = { repos: useStore((s) => s.repos), agents: useStore((s) => s.agents), qa: useStore((s) => s.qa) };
  const openRef = useRefOpen();
  const open = action.ref ? openRef({ ...action.ref, start: 0, end: 0 }) : null;
  const status: ActionStatus | null = action.refused ? { label: 'refused', tone: 'bad' } : action.ref ? actionStatus(action.ref, world) : null;
  const body = (
    <>
      <span className="action-card-icon" aria-hidden>
        {action.icon}
      </span>
      <span className="grow action-card-text">{action.text}</span>
      {status && <span className={`action-chip ${status.tone ? `action-chip-${status.tone}` : ''}`}>{status.label}</span>}
      {status?.merged && <span className="action-confetti" aria-hidden />}
    </>
  );
  const cls = `action-card ${action.refused ? 'action-card-refused' : ''}`;
  return open ? (
    <button type="button" className={cls} onClick={open} aria-label={`${action.text}${status ? `, ${status.label}` : ''}. Open it.`}>
      {body}
    </button>
  ) : (
    <div className={cls}>{body}</div>
  );
}

/** What a CEO reply changed in the office. */
export function ActionCards({ actions }: { actions: readonly ChatAction[] }) {
  return (
    <div className="action-cards" role="group" aria-label="What this reply changed">
      {actions.map((a, i) => (
        <ActionCard key={i} action={a} />
      ))}
    </div>
  );
}

const IDEA_ICON: Record<ChatIdea['kind'], string> = { objective: '🎯', focus: '🔭', mandate: '📜', experiment: '🧪', research: '🔎', charter: '🧭', team: '👥', plan: '🗺️' };

/** The CEO's suggestion about how the office works: Accept sends its message, Edit puts it in the box, Not now hides it. */
export function IdeaCard({ idea, ceoName, onAccept, onEdit }: { idea: ChatIdea; ceoName: string; onAccept: () => void; onEdit: () => void }) {
  const [hidden, setHidden] = useState(false);
  if (hidden) return null;
  return (
    <div className="idea-card" role="group" aria-label={`${ceoName} suggests: ${idea.title}`}>
      <div className="idea-card-head">
        <span aria-hidden>{IDEA_ICON[idea.kind]}</span>
        <span className="idea-card-kind">{idea.kind}</span>
      </div>
      <b className="idea-card-title">{idea.title}</b>
      <div className="idea-card-actions">
        <button type="button" className="btn btn-small btn-good" onClick={onAccept}>
          Accept
        </button>
        <button type="button" className="btn btn-small" onClick={onEdit}>
          Edit
        </button>
        <button type="button" className="btn btn-small btn-ghost" onClick={() => setHidden(true)}>
          Not now
        </button>
      </div>
    </div>
  );
}

/** While the CEO is on a job: the step it's on in plain words, for how long, Stop, and the job waiting next. */
export function WorkingStrip({ onStop }: { onStop: () => void }) {
  const info = useStore((s) => s.ceo);
  const live = useStore((s) => s.chat.live);
  const working = useStore((s) => s.agents[CEO_ID]?.status === 'working');
  const [start, setStart] = useState(() => Date.now()); // when this tab saw the job start; the live reply's own start wins
  const [now, setNow] = useState(() => Date.now());
  const label = info.job?.label;
  useEffect(() => setStart(Date.now()), [label]);
  useEffect(() => {
    if (!working) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [working]);
  const line = working ? workingLine(info.job, live && currentStep(live), info.queue) : null;
  if (!line) return null;
  return (
    <div className="working-strip" role="status">
      <span className="working-dot" aria-hidden />
      <span className="grow working-text">
        <b>{line.now}</b>
        <span className="muted"> · {elapsed(now - (live?.since ?? start))}</span>
        {line.next && <span className="working-next muted">Next: {line.next}</span>}
      </span>
      <button type="button" className="btn btn-small btn-bad" onClick={onStop} title="Stop: what's done stays done">
        ■ Stop
      </button>
    </div>
  );
}

/** Starter chips for an empty message box, fitting the office now; a tap fills the box, never sends. */
export function Starters({ onPick }: { onPick: (text: string) => void }) {
  const repos = useStore((s) => s.repos);
  const busy = useStore((s) => Object.values(s.agents).filter((a) => a.id !== CEO_ID && a.status === 'working').length);
  const chips = starterChips({ floors: repos.map((r) => ({ floor: r.floor, issues: r.issues.length, objectives: r.charter.objectives.length, proposal: !!r.charter.proposal })), busy });
  return (
    <>
      {chips.map((c) => (
        <button key={c} type="button" className="quick-chip starter-chip" onClick={() => onPick(c)} aria-label={`Start a message: ${c}`}>
          ✦ {c.trim()}
          {c.endsWith(' ') && '…'}
        </button>
      ))}
    </>
  );
}

/** "Today", "Yesterday" or the date above the first message of a day. */
export function DaySeparator({ prev, at }: { prev: number | undefined; at: number }) {
  const label = daySeparator(prev, at, Date.now());
  return (
    label && (
      <div className="chat-day" role="separator">
        {label}
      </div>
    )
  );
}
