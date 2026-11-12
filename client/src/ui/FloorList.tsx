// The list view (Settings → Accessibility, or the phone): a floor as a table of who is there, their status and what
// they're doing, with the panels you'd otherwise walk to. For anyone who can't use the 3D view; works by keyboard
// and screen reader. In the lobby it lists the CEO and every floor.
import { useMemo, useState } from 'react';
import { agentsOnRepo, floorPrCounts, useStore } from '../store';
import { CEO_ID } from '../../../shared/types';
import { floorRows, type FloorRow } from './floorRows';
import { Icon } from './Icon';
import { Panel } from './Panel';
import { Avatar } from './phoneParts';
import './floorList.css';

function People({ rows, caption }: { rows: FloorRow[]; caption: string }) {
  const openOverlay = useStore((s) => s.openOverlay);
  if (!rows.length) return <p className="muted">Nobody works here yet.</p>;
  return (
    // a row per person, stacking on a narrow screen instead of a table squeezing its words (#527)
    <ul className="fl-rows" aria-label={caption}>
      {rows.map((r) => (
        <li key={r.id} className="ds-row fl-person">
          <Avatar name={r.name} color={r.color} />
          <div className="ds-row-main">
            <div className="fl-person-head">
              <span className="ds-row-title">{r.name}</span>
              <span className="ds-row-meta">{r.agent}</span>
              <span className={`status-kind status-kind-${r.kind}`}>
                <Icon name={r.icon} /> {r.status}
              </span>
            </div>
            <div className="ds-row-meta">{r.doing}</div>
          </div>
          <button className="btn btn-small" onClick={() => openOverlay({ kind: 'terminal', agentId: r.id })} aria-label={r.signIn ? `Sign ${r.name}'s ${r.signIn} in, in their terminal` : `Open ${r.name}'s terminal`}>
            {r.signIn ? (
              <>
                <Icon name="key-round" /> Sign in
              </>
            ) : (
              'Terminal'
            )}
          </button>
        </li>
      ))}
    </ul>
  );
}

export function FloorList() {
  const floor = useStore((s) => s.floor);
  const repos = useStore((s) => s.repos);
  const agents = useStore((s) => s.agents);
  const qa = useStore((s) => s.qa);
  const settings = useStore((s) => s.settings);
  const clis = useStore((s) => s.clis);
  const ceoJob = useStore((s) => s.ceo.job);
  const openOverlay = useStore((s) => s.openOverlay);
  const goToFloor = useStore((s) => s.goToFloor);
  const [shown, setShown] = useState(floor);
  const repo = repos.find((r) => r.floor === shown) ?? null;
  const rows = useMemo(
    () => floorRows(repo ? agentsOnRepo(agents, repo.id) : agents[CEO_ID] ? [agents[CEO_ID]] : [], settings, clis, ceoJob),
    [repo, agents, settings, clis, ceoJob],
  );
  const counts = repo ? floorPrCounts(repo, qa) : null;
  const busy = rows.filter((r) => r.kind === 'busy' || r.kind === 'waiting').length;

  return (
    <Panel
      title={
        <span>
          <Icon name="users" /> {repo ? `Floor ${repo.floor}: ${repo.fullName}` : 'Lobby'}
        </span>
      }
      className="floor-list"
    >
      <div className="row wrap">
        <label className="field-inline">
          <span>Floor</span>
          <select value={shown} onChange={(e) => setShown(Number(e.target.value))}>
            <option value={0}>Lobby</option>
            {repos.map((r) => (
              <option key={r.id} value={r.floor}>
                {r.floor} · {r.fullName}
              </option>
            ))}
          </select>
        </label>
        <span className="spacer" />
        {shown !== floor && (
          <button className="btn btn-small" onClick={() => goToFloor(shown)}>
            <Icon name="door-open" /> Go there
          </button>
        )}
        {repo && (
          <>
            <button className="btn btn-small" onClick={() => openOverlay({ kind: 'kanban', repoId: repo.id })}>
              <Icon name="clipboard-list" /> Kanban
            </button>
            <button className="btn btn-small" onClick={() => openOverlay({ kind: 'app', repoId: repo.id })}>
              <Icon name="monitor" /> App
            </button>
          </>
        )}
      </div>
      {repo && counts && (
        <p className="floor-summary">
          {rows.length} {rows.length === 1 ? 'person' : 'people'}, {busy} busy · {repo.issues.length} open issue{repo.issues.length === 1 ? '' : 's'} · {counts.inQa} in QA · {counts.ready} ready to merge
          {counts.needsYou ? ` · ${counts.needsYou} need${counts.needsYou === 1 ? 's' : ''} you` : ''}
        </p>
      )}
      <People rows={rows} caption={repo ? `Who is on floor ${repo.floor}` : 'Who is in the lobby'} />
      {!repo && repos.length > 0 && (
        <>
          <h3>Floors</h3>
          <ul className="fl-rows">
            {repos.map((r) => {
              const team = agentsOnRepo(agents, r.id);
              const working = team.filter((a) => a.status === 'working' || a.status === 'preparing').length;
              return (
                <li key={r.id}>
                  <button type="button" className="ds-row fl-floor" style={{ ['--accent' as string]: r.color }} onClick={() => goToFloor(r.floor)} aria-label={`Go to floor ${r.floor}: ${r.fullName}`}>
                    <span className="floor-badge">{r.floor}</span>
                    <span className="ds-row-main">
                      <span className="ds-row-title">{r.fullName}</span>
                      <span className="ds-row-meta">
                        {team.length} {team.length === 1 ? 'person' : 'people'} · {working} working
                      </span>
                    </span>
                    <Icon name="chevron-right" />
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </Panel>
  );
}
