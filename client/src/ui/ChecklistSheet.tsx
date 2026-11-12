// A checklist (#612): its tile (title, floor, "3 of 6 done" and its bar), the same from the chat, the Checklists page and
// a floor's board, and the full checklist in a sheet one tap away, with Duplicate for another account. Both read the
// store's copy, which the office's `checklist` events keep live.
import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { useStore } from '../store';
import { progress, progressText, type Checklist } from '../../../shared/checklists';
import { Sheet } from './ChatArtifacts';
import { StepRow } from './ChecklistStep';
import { Icon } from './Icon';
import { ProgressBar } from './ProgressBar';
import { pushLayer } from './backStack';
import './checklists.css';

const share = (c: Checklist) => {
  const p = progress(c);
  return p.total ? p.done / p.total : 0;
};

function Duplicate({ c, onDone }: { c: Checklist; onDone: (id: string | null) => void }) {
  const [title, setTitle] = useState(`${c.title} · another account`);
  return (
    <form
      className="cl-inline"
      onSubmit={(e) => {
        e.preventDefault();
        void api.checklistDuplicate(c.id, title).then((d) => onDone(d.id), () => undefined);
      }}
    >
      <input type="text" value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} aria-label="Name of the copy" />
      <button type="submit" className="btn btn-small">Duplicate</button>
      <button type="button" className="btn btn-small btn-ghost" onClick={() => onDone(null)}>Cancel</button>
    </form>
  );
}

export function ChecklistSheet({ id, onClose }: { id: string; onClose: () => void }) {
  const [shown, setShown] = useState(id);
  const c = useStore((s) => s.checklists.find((x) => x.id === shown));
  const floor = useStore((s) => (c?.repoId ? s.repos.find((r) => r.id === c.repoId)?.floor : undefined));
  const [dup, setDup] = useState(false);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => pushLayer(() => close.current()), []); // Back closes it
  useEffect(() => setShown(id), [id]);
  return (
    <Sheet label={<><Icon name="check-check" /> {c?.title ?? 'Checklist'}</>} onClose={onClose} className="cl-sheet">
      <div className="artifact-body cl-body">
        {!c ? (
          <p className="muted">This checklist is no longer kept: finished ones go after a month.</p>
        ) : (
          <>
            <ProgressBar label={progressText(c)} value={floor !== undefined ? `Floor ${floor}` : undefined} pct={share(c)} tone={progress(c).finished ? 'good' : 'neutral'} aria={`${c.title}: ${progressText(c)}`} />
            <ol className="cl-steps">
              {c.steps.map((s, i) => (
                <StepRow key={`${c.id}:${s.id}`} c={c} s={s} n={i + 1} />
              ))}
            </ol>
            {dup ? (
              <Duplicate c={c} onDone={(d) => (setDup(false), d && setShown(d))} />
            ) : (
              <div className="cl-actions">
                <button type="button" className="btn btn-small btn-ghost" onClick={() => setDup(true)}>
                  <Icon name="copy" /> Duplicate for another account
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </Sheet>
  );
}

/** A checklist's tile: a button that opens it. */
export function ChecklistTile({ c, onOpen }: { c: Checklist; onOpen: () => void }) {
  const floor = useStore((s) => (c.repoId ? s.repos.find((r) => r.id === c.repoId)?.floor : undefined));
  const p = progress(c);
  return (
    <button type="button" className={`cl-tile${p.finished ? ' cl-tile-done' : ''}`} onClick={onOpen} data-checklist={c.id}>
      <span className="cl-tile-head">
        <Icon name={p.finished ? 'circle-check' : 'check-check'} />
        <span className="cl-tile-title">{c.title}</span>
        <Icon name="chevron-right" />
      </span>
      <ProgressBar compact label={progressText(c)} value={floor !== undefined ? `Floor ${floor}` : undefined} pct={share(c)} tone={p.finished ? 'good' : 'neutral'} aria={`${c.title}: ${progressText(c)}`} />
    </button>
  );
}

/** The card in the CEO chat: the live checklist, opened in one tap. */
export function ChecklistCard({ id }: { id: string }) {
  const c = useStore((s) => s.checklists.find((x) => x.id === id));
  const [open, setOpen] = useState(false);
  if (!c) return <div className="notice-card"><p className="notice-card-title muted">A checklist that is no longer kept.</p></div>;
  return (
    <div className="notice-card cl-card">
      <ChecklistTile c={c} onOpen={() => setOpen(true)} />
      {open && <ChecklistSheet id={id} onClose={() => setOpen(false)} />}
    </div>
  );
}

/** A floor's open checklists, pinned on its board. */
export function FloorChecklists({ repoId }: { repoId: string }) {
  const list = useStore((s) => s.checklists).filter((c) => c.repoId === repoId && !progress(c).finished);
  const [open, setOpen] = useState<string | null>(null);
  if (!list.length) return null;
  return (
    <section className="cl-pinned" aria-label="Checklists for this floor">
      {list.map((c) => (
        <ChecklistTile key={c.id} c={c} onOpen={() => setOpen(c.id)} />
      ))}
      {open && <ChecklistSheet id={open} onClose={() => setOpen(null)} />}
    </section>
  );
}
