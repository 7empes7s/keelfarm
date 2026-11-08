// Assign to… (#265): on a Kanban issue card and the issue sheet, an action sheet of the floor's agents, free ones first
// (they start the issue now), then busy ones (it waits as their next task, after the one they're on: nothing stops).
// The server decides (shared/assignIssue.ts); the CEO hears of it as one of the manager's changes (#207).
import { useMemo, useState } from 'react';
import { assignOrder } from '../../../shared/assignIssue';
import { api } from '../api';
import { agentsOnRepo, useStore, type Agent } from '../store';
import { AgentRing } from './AgentRing';
import { doingText } from './floorRows';
import { Icon } from './Icon';
import { Sheet } from './Sheet';
import './assignSheet.css';

/** Can they start an issue right now (the server's startable(), as far as a tab can tell)? */
const startable = (a: Agent) => a.status !== 'working' && a.status !== 'preparing' && !a.needsSignIn && !a.waiting;

export function AssignButton({ repoId, number, title, small }: { repoId: string; number: number; title: string; small?: boolean }) {
  const [open, setOpen] = useState(false);
  const next = useStore((s) => Object.values(s.agents).find((a) => a.repoId === repoId && a.nextIssue === number));
  return (
    <>
      <button type="button" className={small ? 'btn btn-small' : 'ds-btn'} aria-haspopup="dialog" aria-label={`Assign issue #${number}${next ? `: next for ${next.name}` : ''}`} onClick={() => setOpen(true)}>
        <Icon name="user" /> {next ? `Next for ${next.name}` : 'Assign to…'}
      </button>
      {open && <AssignSheet repoId={repoId} number={number} title={title} onClose={() => setOpen(false)} />}
    </>
  );
}

function AssignSheet({ repoId, number, title, onClose }: { repoId: string; number: number; title: string; onClose: () => void }) {
  const all = useStore((s) => s.agents);
  const team = useMemo(() => assignOrder(agentsOnRepo(all, repoId).filter((a) => a.role !== 'ceo').map((a) => ({ ...a, free: startable(a) }))), [all, repoId]);
  const [busy, setBusy] = useState<string | null>(null);
  const pick = async (a: Agent) => {
    setBusy(a.id);
    try {
      const out = await api.assignIssue(repoId, number, a.id);
      useStore.getState().pushToast('success', out.text);
      onClose();
    } catch {
      setBusy(null); // toasted
    }
  };
  const free = team.filter((a) => a.free);
  const rest = team.filter((a) => !a.free);
  const row = (a: (typeof team)[number]) => (
    <li key={a.id}>
      <button type="button" className="assign-row" disabled={!!busy} onClick={() => void pick(a)}>
        <AgentRing agent={a} size="sm" />
        <span className="assign-text">
          <span className="assign-name">
            {a.name} <Icon name={a.host === 'box' ? 'cloud' : 'monitor'} label={a.host === 'box' ? 'cloud agent' : 'on this computer'} />
          </span>
          <span className="assign-meta">
            {a.free ? 'Starts it now' : `After their current task · ${doingText(a)}`}
            {a.nextIssue != null && a.nextIssue !== number && ` · replaces next #${a.nextIssue}`}
            {a.nextIssue === number && ' · already next'}
          </span>
        </span>
        {busy === a.id && <span className="muted small">Assigning…</span>}
      </button>
    </li>
  );
  return (
    <Sheet title={`Assign #${number}`} onClose={onClose} className="assign-sheet">
      <p className="assign-issue muted small">{title}</p>
      {team.length === 0 && <p className="muted">This floor has no agents yet: add one in Team.</p>}
      {free.length > 0 && (
        <section aria-label="Free now">
          <h3 className="assign-group">Free now</h3>
          <ul className="assign-list">{free.map(row)}</ul>
        </section>
      )}
      {rest.length > 0 && (
        <section aria-label="Busy">
          <h3 className="assign-group">Busy: it waits as their next task</h3>
          <ul className="assign-list">{rest.map(row)}</ul>
        </section>
      )}
      <button type="button" className="ds-btn assign-cancel" onClick={onClose}>
        Cancel
      </button>
    </Sheet>
  );
}
