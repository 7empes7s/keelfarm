// The test lab desk (#56): what the office's shared browser and heavy runs do for the agents. Its queue, the job
// running, recent results with thumbnails (a failure links to its agent and pull request) and each floor's use, on
// the console's Floors tab (so pocket mode shows it too); and its settings (Settings → Office).
import { useState } from 'react';
import { useStore } from '../store';
import type { LabJobKind, LabJobView, LabResultView, TestLabSettings } from '../../../shared/testLab';
import { Section } from './DetailsPage';
import { Icon } from './Icon';
import type { IconName } from './icons';
import { ProgressBar } from './ProgressBar';
import './testLab.css';

const ago = (at: number) => `${Math.max(0, Math.round((Date.now() - at) / 60_000))} min ago`;
const KIND_ICON: Record<LabJobKind, IconName> = { screenshot: 'image', check: 'mouse-pointer-click', run: 'terminal' };

/** One queue or result row (#313): a fixed slot, a status, a one-line title and line, the time, then the agent and PR. */
function LabRow({ job, result, line, time }: { job: LabJobView; result?: LabResultView; line: string; time: string }) {
  const repos = useStore((s) => s.repos);
  const openOverlay = useStore((s) => s.openOverlay);
  const [open, setOpen] = useState(false);
  const repo = repos.find((x) => x.id === job.repoId);
  const status = result ? (result.ok ? 'check' : 'x') : 'hourglass';
  return (
    <li className={`lab-row${open ? ' lab-row-open' : ''}`}>
      <span className="lab-slot" aria-hidden>
        {result?.shot ? <img className="lab-thumb" src={`/api/testlab/shot/${result.id}`} alt="" loading="lazy" /> : <Icon name={KIND_ICON[job.kind]} />}
      </span>
      <button type="button" className="lab-text" aria-expanded={open} onClick={() => setOpen(!open)} title={`${job.title}: ${line}`}>
        <span className="lab-line">
          <span className={result ? (result.ok ? 'office-state-ok' : 'office-state-bad') : 'muted'}>
            <Icon name={status} label={result ? (result.ok ? 'Passed' : 'Failed') : 'Waiting'} />
          </span>
          <b className="lab-clip">{job.title}</b>
          <span className="muted lab-time">{time}</span>
        </span>
        <span className="muted lab-clip">{line}</span>
      </button>
      <span className="lab-links">
        <button type="button" className="lab-chip" onClick={() => openOverlay({ kind: 'terminal', agentId: job.agentId })} title={`${job.agent}'s terminal`}>
          <Icon name="user" /> {job.agent}
        </button>
        {repo && job.pr && (
          <a className="lab-chip" href={`${repo.url}/pull/${job.pr}`} target="_blank" rel="noreferrer" title={`Pull request #${job.pr} on GitHub`}>
            <Icon name="git-branch" /> #{job.pr}
          </a>
        )}
      </span>
    </li>
  );
}

export function TestLabCard() {
  const lab = useStore((s) => s.testLab);
  const openOverlay = useStore((s) => s.openOverlay);
  if (!lab?.enabled) return null;
  const state = lab.held ?? (lab.running.length ? null : 'Idle: agents ask it for screenshots, browser checks and heavy runs');
  return (
    <Section
      id="ops-card-lab"
      className="lab-card"
      title={
        <span className="dp-chips">
          <Icon name="flask-conical" /> Test lab
        </span>
      }
    >
      <div className="dp-meta">
        {lab.running.length} running · {lab.queue.length} waiting · browser {lab.browser === 'up' ? 'on' : 'off'}
      </div>
      {state && (
        <div className={`small office-state ${lab.held ? 'office-state-bad' : 'office-state-ok'}`} role="status">
          {state}
        </div>
      )}
      {lab.running.map((j) => (
        <ProgressBar
          key={j.id}
          label={`${j.title} · ${j.agent} · floor ${j.floor}`}
          value={j.startedAt ? `${Math.max(0, Math.round((Date.now() - j.startedAt) / 60_000))} min` : 'starting'}
          pct={null}
          compact
          aria={`Lab run for ${j.agent}: ${j.title}, running`}
          onClick={() => openOverlay({ kind: 'terminal', agentId: j.agentId })}
          tap={`Open ${j.agent}'s terminal`}
        />
      ))}
      {(lab.queue.length > 0 || lab.recent.length > 0) && (
        <ul className="lab-rows">
          {lab.queue.slice(0, 5).map((j, i) => (
            <LabRow key={j.id} job={j} line={`${i + 1} in line · floor ${j.floor}`} time={ago(j.queuedAt)} />
          ))}
          {lab.recent.slice(0, 6).map((r) => (
            <LabRow key={r.id} job={r} result={r} line={r.summary} time={ago(r.endedAt)} />
          ))}
        </ul>
      )}
      {lab.usage.length > 0 && (
        <div className="dp-meta">
          Use: {[...lab.usage].sort((a, b) => a.floor - b.floor).map((u) => `floor ${u.floor} ${u.jobs} job${u.jobs === 1 ? '' : 's'} (${Math.round(u.ms / 60_000)} min)`).join(' · ')}
        </div>
      )}
    </Section>
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
