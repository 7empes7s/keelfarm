import { useEffect, useRef, useState, type ReactNode } from 'react';
import { api } from '../api';
import { useStore } from '../store';
import { chatDecisions, waitingDecisions, type Decision } from '../../../shared/decisions';
import { ago } from '../../../shared/usage';
import { Menu } from './Menu';
import { Sheet } from './Sheet';
import { sendToCeo } from './chatSend';
import './decisions.css';

// Open decisions (#114, shared/decisions.ts): the chat's "Waiting on you" tray just above the message box, and the
// CEO's open questions in the approvals. An option answers it the way its own buttons would: a reply to the message
// that asked it, or the team change's or charter's own call. Not now / Drop it are in its ⋯. Tapping the question opens
// it whole in a sheet, with the message that asked it (#183).

const ICON: Record<Decision['kind'], string> = { suggestion: '🧭', question: '❓', team: '👥', charter: '🎯' };
/** api() already toasted a failure. */
const attempt = (fn: () => Promise<unknown>) => fn().catch(() => undefined);

/** The clock snoozes end on: once a minute is plenty for "2 h ago" and a 24-hour snooze. */
export function useMinute() {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);
  return now;
}

/** Answers a team change or charter proposal with its own call; anything else is a reply to the message that asked. */
function answer(d: Decision, option: string, approve?: boolean) {
  if (d.kind === 'team') return void attempt(() => (approve ? api.approveRequest(d.id.slice('team:'.length)) : api.rejectRequest(d.id.slice('team:'.length))));
  if (d.kind === 'charter') return void attempt(() => api.decideCharter(d.repoIds[0], !!approve));
  sendToCeo(option, d.messageId ?? undefined);
}

export function DecisionCard({ d, now, onPick, onJump }: { d: Decision; now: number; onPick?: (d: Decision, option: string) => void; onJump?: (messageId: number) => void }) {
  const repos = useStore((s) => s.repos);
  const [whole, setWhole] = useState(false);
  const floors = d.repoIds.map((id) => repos.find((r) => r.id === id)?.floor).filter((f): f is number => f !== undefined);
  const pick = (option: string, approve?: boolean) => {
    setWhole(false);
    if (onPick && d.kind !== 'team' && d.kind !== 'charter') onPick(d, option);
    else answer(d, option, approve);
  };
  const options = d.kind === 'team' || d.kind === 'charter' ? null : d.options;
  const asked = d.raised > 1 ? `asked ${d.raised}×` : '';
  const meta = [ago(d.lastAskedAt, now), floors.length ? `floor ${floors.join(', ')}` : '', asked].filter(Boolean).join(' · ');
  const buttons = (
    <div className="decision-options">
      {options
        ? options.map((o) => (
            <button key={o} type="button" className="decision-option" onClick={() => pick(o)} aria-label={`Answer “${o}”`}>
              {o}
            </button>
          ))
        : [
            <button key="yes" type="button" className="decision-option decision-yes" onClick={() => pick('Approve', true)}>
              Approve
            </button>,
            <button key="no" type="button" className="decision-option" onClick={() => pick('Decline', false)}>
              Decline
            </button>,
          ]}
    </div>
  );
  return (
    <article className="decision-card" aria-label={d.question}>
      <div className="decision-head">
        <span className="decision-icon" aria-hidden>
          {ICON[d.kind]}
        </span>
        <div className="grow">
          <button type="button" className="decision-q" aria-haspopup="dialog" onClick={() => setWhole(true)}>
            {d.question}
          </button>
          <div className="decision-meta small muted">{meta}</div>
        </div>
        <Menu
          label={`More for “${d.question}”`}
          items={[
            { label: '⏰ Not now', hint: 'Back in 24 hours', onSelect: () => void attempt(() => api.decideOpen(d.id, 'snooze')) },
            { label: '🗑 Drop it', hint: 'Never raised again', onSelect: () => void attempt(() => api.decideOpen(d.id, 'drop')) },
            onJump && d.messageId !== null && { label: '↪ Jump to the message', onSelect: () => onJump(d.messageId!) },
          ]}
        />
      </div>
      {buttons}
      {whole && (
        <Sheet title={`${ICON[d.kind]} Waiting on you`} onClose={() => setWhole(false)} className="decision-sheet">
          <p className="decision-sheet-q">{d.question}</p>
          <div className="decision-chips">
            {floors.map((f) => (
              <span key={f} className="decision-chip">
                Floor {f}
              </span>
            ))}
            <span className="small muted">{[ago(d.lastAskedAt, now), asked].filter(Boolean).join(' · ')}</span>
          </div>
          {d.context && d.context !== d.question && <p className="decision-context">{d.context}</p>}
          {buttons}
          {onJump && d.messageId !== null && (
            <button
              type="button"
              className="decision-jump"
              onClick={() => {
                setWhole(false);
                onJump(d.messageId!);
              }}
            >
              ↪ Jump to the message
            </button>
          )}
        </Sheet>
      )}
    </article>
  );
}

/**
 * Above the chat's message box: a row of decision cards, or one pill when collapsed. It collapses while the manager
 * types, so it never covers the composer or the keyboard. `hide`: the message whose own chips show under it.
 */
export function DecisionTray({ hide, typing, onPick, onJump }: { hide?: number; typing: boolean; onPick: (d: Decision, option: string) => void; onJump: (messageId: number) => void }) {
  const all = useStore((s) => s.decisions);
  const now = useMinute();
  const [open, setOpen] = useState(true);
  const [page, setPage] = useState(0);
  const row = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (typing) setOpen(false);
  }, [typing]);
  const list = waitingDecisions(all, now).filter((d) => d.messageId !== hide);
  if (!list.length) return null;
  const at = Math.min(page, list.length - 1);
  // one card per page, snapped whole: which one shows
  const onScroll = () => {
    const el = row.current;
    if (el?.clientWidth) setPage(Math.round(el.scrollLeft / el.clientWidth));
  };
  const label = `${list.length} decision${list.length === 1 ? '' : 's'} waiting`;
  if (!open)
    return (
      <div className="decision-tray decision-tray-closed">
        <button type="button" className="decision-pill" aria-expanded={false} onClick={() => setOpen(true)}>
          🧭 {label}
        </button>
      </div>
    );
  return (
    <section className="decision-tray" aria-label="Waiting on you">
      <div className="decision-tray-head">
        <b className="small grow">🧭 Waiting on you · {list.length}</b>
        {list.length > 1 && (
          <span className="decision-pages small muted" aria-live="polite">
            <span className="decision-dots" aria-hidden>
              {list.map((d, i) => (
                <i key={d.id} className={i === at ? 'on' : ''} />
              ))}
            </span>
            {at + 1} of {list.length}
          </span>
        )}
        <button type="button" className="decision-collapse" aria-expanded aria-label={`Hide the ${label}`} onClick={() => setOpen(false)}>
          ⌄
        </button>
      </div>
      <div className="decision-row" ref={row} onScroll={onScroll}>
        {list.map((d) => (
          <DecisionCard key={d.id} d={d} now={now} onPick={onPick} onJump={onJump} />
        ))}
      </div>
    </section>
  );
}

export const DECISIONS_GROUP = '🧭 Questions from the CEO';

/** The CEO's open questions for the approvals (their team changes and charter changes are cards there already). */
export function DecisionList({ heading }: { heading: (text: string) => ReactNode }) {
  const all = useStore((s) => s.decisions);
  const now = useMinute();
  const list = chatDecisions(all, now);
  if (!list.length) return null;
  return (
    <>
      {heading(DECISIONS_GROUP)}
      <div className="decision-list">
        {list.map((d) => (
          <DecisionCard key={d.id} d={d} now={now} />
        ))}
      </div>
    </>
  );
}
