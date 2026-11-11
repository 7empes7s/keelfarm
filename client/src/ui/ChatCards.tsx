import { useEffect, useState } from 'react';
import { api } from '../api';
import { useStore } from '../store';
import type { ChatAction } from '../../../shared/ceoActions';
import { currentStep } from '../../../shared/ceoStream';
import { CEO_ID, type ChatCeoStuck, type ChatIdea, type ChatNotice } from '../../../shared/types';
import { actionStatus, daySeparator, elapsed, starterChips, workingLine, type ActionStatus } from './chatCardRules';
import { Icon } from './Icon';
import { iconFor, type IconName } from './icons';
import { useActionOpen, useRefOpen } from './RefChips';
import { SignInSheet } from './SignInSheet';
import { StepLogList } from './ChatLive';
import './chatCards.css';

// The CEO chat's cards (#108): what a reply did as action cards with a live status, its idea card (Accept / Edit /
// Not now), the "working on it" strip with Stop and the round's live log (#150), and the starter chips of an empty message box. Rules in chatCardRules.ts.

/** One office tool call that changed something; its status follows the issue, PR, floor or agent it names. Undo (#403) puts back what it changed. */
function ActionCard({ action, onUndo }: { action: ChatAction; onUndo?: () => void }) {
  const world = { repos: useStore((s) => s.repos), agents: useStore((s) => s.agents), qa: useStore((s) => s.qa) };
  const openAction = useActionOpen();
  const open = action.ref ? openAction(action.ref) : null;
  const status: ActionStatus | null = action.refused ? { label: 'refused', tone: 'bad' } : action.undone ? { label: 'undone' } : action.ref ? actionStatus(action.ref, world) : null;
  const body = (
    <>
      <span className="action-card-icon" aria-hidden>
        <Icon name={iconFor(action.icon, 'zap')} />
      </span>
      <span className="grow action-card-text">
        {action.text}
        {action.askedIn !== undefined && <span className="action-card-asked"> · you asked in #{action.askedIn}</span>}
      </span>
      {status && <span className={`action-chip ${status.tone ? `action-chip-${status.tone}` : ''}`}>{status.label}</span>}
      {status?.merged && <span className="action-confetti" aria-hidden />}
    </>
  );
  const cls = `action-card ${action.refused ? 'action-card-refused' : ''}`;
  const card = open ? (
    <button type="button" className={cls} onClick={open} aria-label={`${action.text}${status ? `, ${status.label}` : ''}. Open it.`}>
      {body}
    </button>
  ) : (
    <div className={cls}>{body}</div>
  );
  if (!action.undo || action.undone || !onUndo) return card;
  return (
    <div className="action-row">
      {card}
      <button type="button" className="btn action-undo" onClick={onUndo} aria-label={`Undo: ${action.text}`}>
        Undo
      </button>
    </div>
  );
}

/** What a CEO reply changed in the office. */
export function ActionCards({ actions, messageId }: { actions: readonly ChatAction[]; messageId?: number }) {
  return (
    <div className="action-cards" role="group" aria-label="What this reply changed">
      {actions.map((a, i) => (
        <ActionCard key={i} action={a} onUndo={messageId === undefined ? undefined : () => void api.undoCeoAction(messageId, i).catch(() => undefined)} />
      ))}
    </div>
  );
}

const IDEA_ICON: Record<ChatIdea['kind'], IconName> = { objective: 'target', focus: 'telescope', mandate: 'scroll-text', experiment: 'flask-conical', research: 'search', charter: 'compass', team: 'users', plan: 'map' };

/** The CEO's suggestion about how the office works: Accept sends its message, Edit puts it in the box, Not now hides it. */
export function IdeaCard({ idea, ceoName, onAccept, onEdit }: { idea: ChatIdea; ceoName: string; onAccept: () => void; onEdit: () => void }) {
  const [hidden, setHidden] = useState(false);
  if (hidden) return null;
  return (
    <div className="idea-card" role="group" aria-label={`${ceoName} suggests: ${idea.title}`}>
      <div className="idea-card-head">
        <span aria-hidden><Icon name={IDEA_ICON[idea.kind]} /></span>
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
              {l.label} <Icon name="external-link" />
            </a>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** Every account is out (#248) but a paused API key: the office's line and Use API key, which turns it on and carries on. */
export function UseKeyCard({ text, account }: { text: string; account: string }) {
  const [busy, setBusy] = useState(false);
  const on = useStore((s) => s.accounts.accounts.some((a) => a.id === account && a.enabled));
  return (
    <div className="notice-card" role="note">
      <p className="notice-card-title">{text}</p>
      <div className="notice-card-links">
        <button type="button" className="btn" disabled={busy || on} onClick={() => {
            setBusy(true);
            void api.useAccountNow(account).finally(() => setBusy(false));
          }}>
          <Icon name="key-round" /> {on ? 'API key on' : 'Use API key'}
        </button>
      </div>
    </div>
  );
}

/** Pacing started on a usage warning (#323): the office's line, Resume full speed for this window, and Always keep full speed (Settings → Agents). */
export function PacingCard({ text }: { text: string }) {
  const [busy, setBusy] = useState(false);
  const pacing = useStore((s) => s.usage.state === 'pacing');
  const always = useStore((s) => s.settings.usageWarnings === 'full');
  const act = (fn: () => Promise<unknown>) => {
    setBusy(true);
    void fn().catch(() => undefined).finally(() => setBusy(false)); // api() already toasted the error
  };
  return (
    <div className="notice-card" role="note">
      <p className="notice-card-title">{text}</p>
      <div className="notice-card-links">
        <button type="button" className="btn" disabled={busy || !pacing} onClick={() => act(api.resumeFullSpeed)}>
          <Icon name="fast-forward" /> Resume full speed
        </button>
        <button type="button" className="btn" disabled={busy || always} title="Remember this choice: usage warnings never pace new work (Settings → Agents)" onClick={() => act(() => api.updateSettings({ usageWarnings: 'full' }))}>
          {always ? 'Full speed kept' : 'Always keep full speed'}
        </button>
      </div>
    </div>
  );
}

/** The CEO's session is stuck (#375): the office's line, its terminal, the account's guided sign-in, and Switch back. */
export function CeoStuckCard({ text, stuck }: { text: string; stuck: ChatCeoStuck }) {
  const [busy, setBusy] = useState(false);
  const [signing, setSigning] = useState(false);
  const account = useStore((s) => s.accounts.accounts.find((a) => a.id === stuck.account));
  const binding = useStore((s) => s.agents[CEO_ID]?.account ?? '');
  const terminal = useRefOpen()({ kind: 'agent', agentId: CEO_ID, terminal: true, start: 0, end: 0 });
  const back = stuck.back;
  const backDone = back !== null && binding === back;
  const signIn = stuck.kind === 'sign-in' && account?.kind === 'subscription-login' && !account.builtIn;
  return (
    <div className="notice-card" role="note">
      <p className="notice-card-title">{text}</p>
      <div className="notice-card-links">
        {terminal && (
          <button type="button" className="btn" onClick={terminal}>
            <Icon name="terminal" /> Open terminal
          </button>
        )}
        {signIn && (
          <button type="button" className="btn" disabled={busy || account.status !== 'signed-out'} onClick={() => {
              setBusy(true);
              void api.signInAccount(account.id).then(() => setSigning(true), () => undefined).finally(() => setBusy(false));
            }}>
            <Icon name="key-round" /> {account.status === 'signed-out' ? 'Sign in' : 'Signed in'}
          </button>
        )}
        {back !== null && (
          <button type="button" className="btn" disabled={busy || backDone} onClick={() => {
              setBusy(true);
              void api.ceoSwitchBack(back).catch(() => undefined).finally(() => setBusy(false)); // api() already toasted the error
            }}>
            <Icon name="undo-2" /> {backDone ? `Back on ${stuck.backLabel ?? 'it'}` : `Switch back to ${stuck.backLabel ?? 'the last account'}`}
          </button>
        )}
      </div>
      {signing && account && <SignInSheet a={account} close={() => setSigning(false)} />}
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
            <Icon name={line.icon ? iconFor(line.icon, 'sparkles') : 'sparkles'} />
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
              <Icon name="chevron-right" />
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
          {confirm ? 'Stop?' : <Icon name="square" />}
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
          <Icon name="sparkle" /> {c.trim()}
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
