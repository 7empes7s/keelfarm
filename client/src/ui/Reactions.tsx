// Reactions (#120; the CEO chat's #118 can reuse them): a long-press (or hover, or the ☺ button) on a message opens the
// bar of emoji; the picked ones show as chips under it. What each one means to the agent: shared/reactions.ts.
import { useRef, useState, type ReactNode } from 'react';
import { REACTIONS, sendsNote, type Reaction } from '../../../shared/reactions';
import { Icon } from './Icon';

const HOLD_MS = 450;

/** The bar of reactions; the ones already picked are pressed. */
function ReactionBar({ picked, onPick }: { picked: readonly Reaction[]; onPick: (r: Reaction) => void }) {
  return (
    <div className="rx-bar" role="toolbar" aria-label="React">
      {REACTIONS.map((r) => (
        <button key={r} type="button" className="rx-pick" aria-pressed={picked.includes(r)} title={sendsNote(r) ? 'React: they get a short note after their current step' : 'React: shown only, not sent'} onClick={() => onPick(r)}>
          {r}
        </button>
      ))}
    </div>
  );
}

/** The chips under a message: the manager's reactions, and the office's status one (👀 ⏳ ✅) on a manager's message. */
export function ReactionChips({ reactions, status, statusLabel }: { reactions?: readonly string[]; status?: string; statusLabel?: string }) {
  if (!reactions?.length && !status) return null;
  return (
    <div className="rx-chips">
      {reactions?.map((r) => (
        <span key={r} className="rx-chip">
          {r}
        </span>
      ))}
      {status && (
        <span className="rx-chip rx-status" title={statusLabel} aria-label={statusLabel}>
          {status}
        </span>
      )}
    </div>
  );
}

/** Something that can be reacted to: long-press on touch, hover on a computer, or its ☺ button (keyboard too). */
export function Reactable({ picked, onPick, label, children }: { picked: readonly Reaction[]; onPick: (r: Reaction) => void; label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const cancel = () => clearTimeout(timer.current);
  return (
    <div
      className={`rx-wrap ${open ? 'rx-open' : ''}`}
      onPointerDown={(e) => {
        if (e.pointerType !== 'touch' || (e.target as HTMLElement).closest('code, pre')) return; // a press on code selects it (#438)
        cancel();
        timer.current = setTimeout(() => setOpen(true), HOLD_MS);
      }}
      onPointerUp={cancel}
      onPointerCancel={cancel}
      onPointerMove={(e) => e.pointerType === 'touch' && (e.movementX || e.movementY) && cancel()}
      onContextMenu={(e) => {
        if (open) e.preventDefault();
      }}
      onMouseLeave={() => setOpen(false)}
    >
      {children}
      <button type="button" className="rx-open-btn" aria-label={`React to ${label}`} aria-expanded={open} title="React" onClick={() => setOpen(!open)}>
        <Icon name="smile-plus" />
      </button>
      {open && (
        <ReactionBar
          picked={picked}
          onPick={(r) => {
            setOpen(false);
            onPick(r);
          }}
        />
      )}
    </div>
  );
}
