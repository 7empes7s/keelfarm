// Company → Checklists (#612): every checklist the CEO gave the manager, open ones first, with filters (open, done,
// per floor) and a search over titles, steps and comments; a tap opens the full checklist. `open`: one to open at
// once (a deep link or the search's pick).
import { useEffect, useState } from 'react';
import { useStore } from '../store';
import { isOpenChecklist, matchChecklist } from '../../../shared/checklists';
import { ChecklistSheet, ChecklistTile } from './ChecklistSheet';
import './checklists.css';

type Show = 'open' | 'done' | 'all';
const SHOWS: { id: Show; label: string }[] = [
  { id: 'open', label: 'Open' },
  { id: 'done', label: 'Done' },
  { id: 'all', label: 'All' },
];

export function ChecklistsPage({ open }: { open?: string }) {
  const all = useStore((s) => s.checklists);
  const repos = useStore((s) => s.repos);
  const [show, setShow] = useState<Show>('open');
  const [floor, setFloor] = useState<string | null>(null); // a repo id, '' for no floor, null for every one
  const [q, setQ] = useState('');
  const [sheet, setSheet] = useState<string | null>(open ?? null);
  useEffect(() => setSheet(open ?? null), [open]);
  const floors = repos.filter((r) => all.some((c) => c.repoId === r.id)).sort((a, b) => a.floor - b.floor);
  const shown = all.filter((c) => (show === 'all' || (show === 'open') === isOpenChecklist(c)) && (floor === null || (c.repoId ?? '') === floor) && matchChecklist(c, q));
  const pill = (on: boolean) => `btn btn-small ${on ? '' : 'btn-ghost'}`;
  return (
    <div className="cn-one cl-page">
      <input type="search" className="cl-search" placeholder="Search checklists, steps and comments" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search checklists" />
      <div className="cl-filter" role="group" aria-label="Show checklists">
        {SHOWS.map((f) => (
          <button key={f.id} type="button" className={pill(show === f.id)} aria-pressed={show === f.id} onClick={() => setShow(f.id)}>
            {f.label} {f.id !== 'all' && <span className="count">{all.filter((c) => (f.id === 'open') === isOpenChecklist(c)).length}</span>}
          </button>
        ))}
      </div>
      {floors.length > 0 && (
        <div className="cl-filter" role="group" aria-label="Floor">
          <button type="button" className={pill(floor === null)} aria-pressed={floor === null} onClick={() => setFloor(null)}>
            Every floor
          </button>
          {floors.map((r) => (
            <button key={r.id} type="button" className={pill(floor === r.id)} aria-pressed={floor === r.id} onClick={() => setFloor(r.id)}>
              Floor {r.floor}
            </button>
          ))}
          <button type="button" className={pill(floor === '')} aria-pressed={floor === ''} onClick={() => setFloor('')}>
            No floor
          </button>
        </div>
      )}
      {shown.length === 0 ? (
        <p className="muted small">{all.length ? 'None here.' : 'No checklists yet. When the CEO gives you steps to do, they come here as a checklist you tick off, and as a card in the chat.'}</p>
      ) : (
        <ul className="cl-list">
          {shown.map((c) => (
            <li key={c.id}>
              <ChecklistTile c={c} onOpen={() => setSheet(c.id)} />
            </li>
          ))}
        </ul>
      )}
      {sheet && <ChecklistSheet id={sheet} onClose={() => setSheet(null)} />}
    </div>
  );
}
