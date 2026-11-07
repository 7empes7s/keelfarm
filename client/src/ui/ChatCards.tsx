import { useEffect, useState } from 'react';
import { useStore } from '../store';
import type { ChatAction } from '../../../shared/ceoActions';
import { currentStep } from '../../../shared/ceoStream';
import { CEO_ID, type ChatIdea, type ChatNotice } from '../../../shared/types';
import { actionStatus, daySeparator, elapsed, starterChips, workingLine, type ActionStatus } from './chatCardRules';
import { useRefOpen } from './RefChips';
import { StepLogList } from './ChatLive';
import './chatCards.css';

// The CEO chat's cards (#108): what a reply did as action cards with a live status, its idea card (Accept / Edit /
// Not now), the "working on it" strip with Stop and the round's live log (#150), and the starter chips of an empty message box. Rules in chatCardRules.ts.

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

/** An office note (#193): one muted, centred line (icon and short text); tap for the whole of a long one. */
export function NoticePill({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  return (
    <button type="button" className={`notice-pill ${open ? 'notice-pill-open' : ''}`} aria-expanded={open} onClick={() => setOpen(!open)}>
      <span className="bubble-office">{text}</span>
    </button>
  );
}

/** A system notice from the office (#138): its line, the output behind it under Details, and links to the commits. */
export function NoticeCard({ text, notice }: { text: string; notice: ChatNotice }) {
  return (
    <div className="notice-card" role="note">
      <p className="notice-card-title">{text}</p>
      {notice.details && (
        <details className="notice-card-details">
          <summary>Details</summary>
          <pre>{notice.details}</pre>
        </details>
      )}
      {notice.links?.length ? (
        <div className="notice-card-links">
          {notice.links.map((l) => (
            <a key={l.url} href={l.url} target="_blank" rel="noreferrer">
              {l.label} ↗
            </a>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** While the CEO is on a job: the step it's on in plain words, for how long, which step, Stop, and the job waiting next. A tap opens the round's live log. */
export function WorkingStrip({ onStop, open, onToggle, linked, onFloor }: { onStop: () => void; open: boolean; onToggle: () => void; linked: (t: string) => string; onFloor: (n: number) => void }) {
  const info = useStore((s) => s.ceo);
  const live = useStore((s) => s.chat.live);
  const working = useStore((s) => s.agents[CEO_ID]?.status === 'working');
  const [start, setStart] = useState(() => Date.now()); // when this tab saw the job start; the live reply's own start wins
  const [now, setNow] = useState(() => Date.now());
  const [confirm, setConfirm] = useState(false);
  const label = info.job?.label;
  useEffect(() => setStart(Date.now()), [label]);
  useEffect(() => {
    if (!working) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [working]);
  useEffect(() => {
    if (!confirm) return;
    const t = setTimeout(() => setConfirm(false), 4000);
    return () => clearTimeout(t);
  }, [confirm]);
  const line = working ? workingLine(info.job, live && currentStep(live), info.queue) : null;
  if (!line) return null;
  const steps = live?.steps ?? [];
  const count = live?.stepCount ?? 0;
  return (
    <div className="working-strip" role="status">
      {open && steps.length > 0 && <StepLogList steps={steps} now={now} live linked={linked} onFloor={onFloor} />}
      <div className="working-row">
        <button type="button" className="working-main" aria-expanded={open} onClick={onToggle} disabled={!steps.length}>
          <span className="working-icon" aria-hidden>
            {line.icon ?? '✻'}
          </span>
          <span className="grow working-text">
            <b className="working-now">{line.now}</b>
            {line.next && <span className="working-next muted">next: {line.next}</span>}
            <span className="working-meta muted">
              {elapsed(now - (live?.since ?? start))}
              {count > 0 && ` · step ${count}`}
            </span>
          </span>
          {steps.length > 0 && (
            <span className="working-chev" aria-hidden>
              ▸
            </span>
          )}
        </button>
        <button
          type="button"
          className={`working-stop ${confirm ? 'working-stop-confirm' : ''}`}
          onClick={() => (confirm ? (setConfirm(false), onStop()) : setConfirm(true))}
          aria-label={confirm ? "Stop? Tap again: what's done stays done" : `Stop ${info.job?.label ?? 'the job'}`}
          title="Stop: what's done stays done"
        >
          {confirm ? 'Stop?' : '■'}
        </button>
      </div>
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
