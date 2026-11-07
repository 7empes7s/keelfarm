// An empty list that teaches (#109): what would show here, why it's empty, and a button for the next step
// (emptyStates.ts has the words). `onAction` swaps in the screen's own step (the board's issue form), `target` a
// more precise place (the CEO message naming the floor).
import { EMPTY, type EmptyKind } from './emptyStates';
import { go, type Target } from './goTo';
import { Icon } from './Icon';
import './finder.css';

export function EmptyState({ kind, why, onAction, target, compact }: { kind: EmptyKind; why?: string; onAction?: () => void; target?: Target; compact?: boolean }) {
  const e = EMPTY[kind];
  return (
    <div className={`empty-state ${compact ? 'empty-state-compact' : ''}`} data-empty={kind}>
      <span className="empty-state-icon">
        <Icon name={e.icon} />
      </span>
      <div className="empty-state-text">
        <b>{e.what}</b>
        <span className="muted small">{why ?? e.why}</span>
      </div>
      <button className="btn btn-small empty-state-go" onClick={onAction ?? (() => go(target ?? e.action.target))}>
        {e.action.label}
      </button>
    </div>
  );
}
