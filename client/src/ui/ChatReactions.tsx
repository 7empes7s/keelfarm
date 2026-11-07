import { useState } from 'react';
import { useStore } from '../store';
import { api } from '../api';
import type { PhoneMessage, StatusReaction } from '../../../shared/types';
import type { CeoLive } from '../../../shared/ceoStream';
import { MANAGER_REACTIONS, MORE_REACTIONS, STATUS_EMOJI, STATUS_WORDS, reactionCounts, reactionLabel, statusLabel } from '../../../shared/reactions';
import './chatReactions.css';

// Reactions in the CEO chat (#118, ui/Phone.tsx): the office's status reaction under the manager's messages (tap: what
// the CEO is on now), the CEO's and the manager's reactions with counts (tap to add or remove yours), and the reaction
// bar in a CEO message's actions, asking what was wrong after a 👎.

const react = (id: number, emoji: string, note?: string) => void api.reactToMessage(id, emoji, note).catch(() => undefined); // api already toasted

/** What a tapped status badge says: the CEO's live step while it works, the job it waits behind while queued. */
function statusNote(s: StatusReaction, live: CeoLive | null, job: string | undefined): string {
  if (s === 'working') return `${STATUS_EMOJI[s]} ${live?.steps.at(-1)?.label ?? 'Working on it'}`;
  if (s === 'queued') return `${STATUS_EMOJI[s]} Next after: ${job ?? 'the job under way'}`;
  if (s === 'failed') return `${STATUS_EMOJI[s]} It failed or was stopped: Retry from the CEO's last message`;
  return `${STATUS_EMOJI[s]} ${STATUS_WORDS[s][0].toUpperCase()}${STATUS_WORDS[s].slice(1)}`;
}

/** The reactions under a bubble, or nothing when it has none. */
export function Reactions({ m, ceoName }: { m: PhoneMessage; ceoName: string }) {
  const [open, setOpen] = useState(false);
  const live = useStore((s) => s.chat.live);
  const job = useStore((s) => s.ceo.job?.label);
  const statuses = useStore((s) => s.settings.statusReactions); // #193: off by default, the working strip says it
  const counts = reactionCounts(m.reactions);
  const status = statuses ? m.status : undefined;
  if (!status && !counts.length) return null;
  return (
    <div className="reactions">
      {status && (
        <button type="button" key={status} className="reaction reaction-status reaction-pop" aria-label={statusLabel(status, ceoName)} aria-expanded={open} onClick={() => setOpen(!open)}>
          {STATUS_EMOJI[status]}
        </button>
      )}
      {counts.map((c) =>
        m.from === 'ceo' ? (
          <button key={c.emoji} type="button" className={`reaction reaction-pop ${c.mine ? 'reaction-mine' : ''}`} aria-pressed={c.mine} aria-label={reactionLabel(c, ceoName)} onClick={() => react(m.id, c.emoji)}>
            {c.emoji}
            {c.count > 1 && <span className="reaction-count">{c.count}</span>}
          </button>
        ) : (
          <span key={c.emoji} className="reaction reaction-pop" role="img" aria-label={reactionLabel(c, ceoName)}>
            {c.emoji}
          </span>
        ),
      )}
      {open && status && (
        <div className="reaction-note" role="status">
          {statusNote(status, live, job)}
        </div>
      )}
    </div>
  );
}

/** The reaction bar at the top of a CEO message's actions; a new 👎 asks what was wrong (optional) before it goes. */
export function ReactionBar({ m, onDone }: { m: PhoneMessage; onDone: () => void }) {
  const [more, setMore] = useState(false);
  const [why, setWhy] = useState<string | null>(null);
  const mine = new Set(m.reactions?.filter((r) => r.by === 'manager').map((r) => r.emoji));
  const pick = (emoji: string) => {
    if (emoji === '👎' && !mine.has(emoji)) return setWhy('');
    onDone();
    react(m.id, emoji);
  };
  const send = (note: string) => {
    onDone();
    react(m.id, '👎', note);
  };
  if (why !== null)
    return (
      <form className="reaction-why" onSubmit={(e) => (e.preventDefault(), send(why))}>
        <label className="small" htmlFor={`why-${m.id}`}>
          👎 What was wrong? (optional)
        </label>
        <textarea id={`why-${m.id}`} rows={2} maxLength={300} value={why} autoFocus onChange={(e) => setWhy(e.target.value)} placeholder="Too long, missed the point…" />
        <div className="chat-menu-actions">
          <button type="submit" className="btn btn-small btn-good">
            Send
          </button>
          <button type="button" className="btn btn-small" onClick={() => send('')}>
            Skip
          </button>
        </div>
      </form>
    );
  const row = (list: readonly string[]) =>
    list.map((e) => (
      <button key={e} type="button" className={`reaction-pick ${mine.has(e) ? 'reaction-mine' : ''}`} aria-pressed={mine.has(e)} aria-label={`${mine.has(e) ? 'Remove' : 'React'} ${e}`} onClick={() => pick(e)}>
        {e}
      </button>
    ));
  return (
    <div className="reaction-bar" role="group" aria-label="React">
      {row(MANAGER_REACTIONS)}
      {more ? (
        row(MORE_REACTIONS)
      ) : (
        <button type="button" className="reaction-pick" aria-label="More reactions" onClick={() => setMore(true)}>
          ＋
        </button>
      )}
    </div>
  );
}
