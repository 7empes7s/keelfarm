// The test lab desk (#56): what the office's shared browser and heavy runs do for the agents. Its queue, the job
// running, recent results with thumbnails (a failure links to its agent and pull request) and each floor's use, on
// the console's Floors tab (so pocket mode shows it too); and its settings (Settings → Office).
import { useStore } from '../store';
import type { LabJobView, TestLabSettings } from '../../../shared/testLab';

const ago = (at: number) => `${Math.max(0, Math.round((Date.now() - at) / 60_000))} min ago`;

export function TestLabCard() {
  const lab = useStore((s) => s.testLab);
  const repos = useStore((s) => s.repos);
  const openOverlay = useStore((s) => s.openOverlay);
  if (!lab?.enabled) return null;
  const prUrl = (j: LabJobView) => {
    const r = repos.find((x) => x.id === j.repoId);
    return r && j.pr ? `${r.url}/pull/${j.pr}` : null;
  };
  const who = (j: LabJobView) => (
    <>
      <button className="btn btn-small btn-ghost" onClick={() => openOverlay({ kind: 'terminal', agentId: j.agentId })} title={`${j.agent}'s terminal`}>
        {j.agent}
      </button>
      {prUrl(j) && (
        <a className="small" href={prUrl(j)!} target="_blank" rel="noreferrer">
          PR #{j.pr}
        </a>
      )}
    </>
  );
  return (
    <div className="card office-card">
      <div className="row wrap">
        <span className="floor-badge office-badge" aria-hidden>
          🧪
        </span>
        <div className="grow">
          <b>Test lab</b>{' '}
          <span className="muted small">
            {lab.running.length} running · {lab.queue.length} waiting · browser {lab.browser === 'up' ? 'on' : 'off'}
          </span>
          <div className={`small office-state ${lab.held ? 'office-state-bad' : lab.running.length ? 'office-state-busy' : 'office-state-ok'}`} role="status">
            {lab.held ?? (lab.running[0] ? `${lab.running[0].title} for ${lab.running[0].agent} (floor ${lab.running[0].floor})` : 'Idle: agents ask it for screenshots, browser checks and heavy runs')}
          </div>
          {lab.queue.slice(0, 5).map((j, i) => (
            <div key={j.id} className="small muted row wrap">
              {i + 1}. {j.title} · floor {j.floor} · {who(j)}
            </div>
          ))}
          {lab.recent.length > 0 && (
            <ul className="lab-results">
              {lab.recent.slice(0, 6).map((r) => (
                <li key={r.id} className="row wrap small">
                  {r.shot && <img className="lab-thumb" src={`/api/testlab/shot/${r.id}`} alt={`Screenshot: ${r.title}`} loading="lazy" />}
                  <span className={r.ok ? 'office-state-ok' : 'office-state-bad'}>{r.ok ? '✓' : '✗'}</span>
                  <span className="grow">
                    {r.title} · {r.summary} · {ago(r.endedAt)}
                  </span>
                  {!r.ok && who(r)}
                </li>
              ))}
            </ul>
          )}
          {lab.usage.length > 0 && (
            <div className="small muted">
              Use: {[...lab.usage].sort((a, b) => a.floor - b.floor).map((u) => `floor ${u.floor} ${u.jobs} job${u.jobs === 1 ? '' : 's'} (${Math.round(u.ms / 60_000)} min)`).join(' · ')}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** Settings → Office: the lab on or off, and how many jobs of each kind it runs at once. */
export function TestLabFields({ testLab, set }: { testLab: TestLabSettings; set: (p: { testLab: TestLabSettings }) => void }) {
  const count = (key: 'browserJobs' | 'heavyJobs', label: string) => (
    <label className="field">
      <span>{label}</span>
      <input key={testLab[key]} type="number" min={1} max={4} defaultValue={testLab[key]} onBlur={(e) => Number(e.target.value) !== testLab[key] && set({ testLab: { ...testLab, [key]: Number(e.target.value) } })} />
    </label>
  );
  return (
    <>
      <label className="toggle">
        <input type="checkbox" checked={testLab.enabled} onChange={(e) => set({ testLab: { ...testLab, enabled: e.target.checked } })} /> Test lab: agents share one browser and queue heavy runs
      </label>
      {count('browserJobs', 'Lab browser jobs at once')}
      {count('heavyJobs', 'Lab heavy runs at once')}
      <p className="muted small">
        Claude Code agents on this computer ask the lab for screenshots, browser checks and full test runs instead of starting their own browser or suite, so memory stays free. Off: each one gets a
        browser of its own again, from their next task.
      </p>
    </>
  );
}
