import { useEffect } from 'react';
import { api } from '../api';
import { fmtDuration, fmtPct, fmtUsd, usageMeter } from '../ops';
import { useStore } from '../store';
import type { DoctorFinding, DoctorFix, OpsAlarm, OpsNumbers, RepoView } from '../../../shared/types';
import { confirmDialog } from './Confirm';
import { CostsSection } from './CostsSection';
import { Actions, Chip, LinkButton, Section } from './DetailsPage';
import { clearDesk } from './dangerActions';
import { ExperimentsSection } from './ExperimentsSection';
import { Icon } from './Icon';
import type { IconName } from './icons';
import { FloorProgress } from './FloorProgress';
import { ManagerChangesCard } from './ManagerChangesCard';
import { Menu } from './Menu';
import { UsageBars } from './UsageBars';
import { UsageSources } from './UsageSources';
import { HealthStrip } from './HealthStrip';
import { ServerCard } from './ServerCard';
import { CloudToday } from './CloudToday';
import { TestLabCard } from './TestLab';
import { WaitTile } from './WaitTile';

// The manager's console → Mission control: Claude's usage with "Resume full speed", the server and what uses it, what needs you (the alarms the
// lobby wall's beacon rings for), the office doctor's findings with their one-click fixes, every floor's numbers
// from the wall as a table, and where the Claude plan goes (CostsSection.tsx).

async function attempt<T>(fn: () => Promise<T>) {
  try {
    return await fn();
  } catch {
    return undefined; // api() already toasted the error
  }
}

/** "Resume full speed": asks first, then clears pacing. From the console's button and E on the lobby's usage meter. */
export async function confirmResume() {
  const { usage, settings } = useStore.getState();
  if (usage.state !== 'pacing') return;
  if (document.pointerLockElement) document.exitPointerLock();
  const m = usageMeter(usage, Date.now());
  const ok = await confirmDialog({
    icon: 'fast-forward',
    tone: 'warn',
    title: 'Resume full speed?',
    body: (
      <>
        <p>
          Claude warned that usage is getting high{usage.warning ? ` (${m.limit})` : ''}, so until {m.resets} new issues only start while fewer than {settings.pacingSessions} session{settings.pacingSessions === 1 ? '' : 's'} run.
        </p>
        <p>Resume if you've topped up or your usage was reset. If Claude still turns a session away at the limit, the office pauses until it resets.</p>
      </>
    ),
    confirm: 'Resume full speed',
  });
  if (ok) await attempt(() => api.resumeFullSpeed());
}

function UsageCard({ hot }: { hot: boolean }) {
  const usage = useStore((s) => s.usage);
  const sessions = useStore((s) => s.settings.pacingSessions);
  const demo = useStore((s) => s.demo);
  const m = usageMeter(usage, Date.now());
  const why =
    usage.state === 'pacing'
      ? `Until ${m.resets}, new issues only start while fewer than ${sessions} session${sessions === 1 ? '' : 's'} run; QA, fixes and the CEO carry on. Topped up, or was your usage reset? Resume full speed.`
      : usage.state === 'paused'
        ? `Claude turned a session away at the limit, so nothing new starts until ${m.resets}. That can't be cleared early; sessions already running carry on.`
        : 'New work starts at full speed. When Claude warns that usage is getting high, the office paces itself (Settings → Sessions while pacing).';
  return (
    <Section
      id="ops-card-usage"
      className={`usage-card usage-${m.tone} ${hot ? 'ops-card-hot' : ''}`}
      title={
        <span className="dp-chips">
          <Icon name="bot" /> Claude usage <Chip tone={m.tone}>{m.state}</Chip>
        </span>
      }
    >
      <UsageBars />
      {usage.warning && (
        <div className="small">
          Last warning: <b>{m.limit}</b>
          {m.resets && ` · resets ${m.resets}`}
        </div>
      )}
      <div className="dp-meta">{why}</div>
      <Actions>
        <button
          className="ds-btn"
          disabled={usage.state !== 'pacing'}
          title={usage.state === 'paused' ? "A pause at the limit can't be cleared early" : usage.state === 'normal' ? 'Already at full speed' : 'Stop pacing new issues now'}
          onClick={() => void confirmResume()}
        >
          <Icon name="fast-forward" /> Resume full speed
        </button>
      </Actions>
      {demo && (
        <div className="row wrap">
          <span className="muted small">Demo:</span>
          <button className="btn btn-small btn-ghost" onClick={() => void attempt(() => api.simulateUsage('warning'))}>
            Simulate a usage warning
          </button>
          <button className="btn btn-small btn-ghost" onClick={() => void attempt(() => api.simulateUsage('limit'))}>
            Simulate reaching the limit
          </button>
        </div>
      )}
    </Section>
  );
}

function AlarmCard({ alarm, repo, hot }: { alarm: OpsAlarm; repo: RepoView | undefined; hot: boolean }) {
  const openOverlay = useStore((s) => s.openOverlay);
  const goToFloor = useStore((s) => s.goToFloor);
  const pr = alarm.prNumber !== null ? repo?.pulls.find((p) => p.number === alarm.prNumber) : undefined;
  return (
    <Section id={`ops-card-${alarm.id}`} tone="bad" className={hot ? 'ops-card-hot' : undefined} title={
        <>
          <Icon name="siren" /> {alarm.text}
        </>
      }
    >
      <div className="dp-meta">
        Floor {alarm.floor} · {repo?.fullName ?? alarm.repoId}
        {pr ? ` · ${pr.title}` : ''} · since {new Date(alarm.since).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
      </div>
      <Actions>
        {alarm.kind === 'pr' && alarm.prNumber !== null ? (
          <>
            <button className="ds-btn" onClick={() => openOverlay({ kind: 'kanban', repoId: alarm.repoId })}>
              <Icon name="clipboard-list" /> Open the Kanban
            </button>
            <button className="ds-btn" onClick={() => void attempt(() => api.sendToQa(alarm.repoId, alarm.prNumber!))}>
              Retry QA
            </button>
            <button className="ds-btn" title="Hand it to its author, or any free agent, with QA's findings" onClick={() => void attempt(() => api.sendBack(alarm.repoId, alarm.prNumber!))}>
              Send back for a fix
            </button>
            {pr && <LinkButton href={pr.url}>PR on GitHub <Icon name="external-link" /></LinkButton>}
          </>
        ) : (
          alarm.agentId && (
            <>
              <button className="ds-btn" onClick={() => openOverlay({ kind: 'terminal', agentId: alarm.agentId! })}>
                Terminal
              </button>
            </>
          )
        )}
        <button className="ds-btn ds-btn-ghost" onClick={() => goToFloor(alarm.floor)}>
          Visit floor {alarm.floor}
        </button>
        {alarm.kind !== 'pr' && alarm.agentId && (
          <Menu label="More for this alarm" title={alarm.text} items={[{ label: 'Clear desk…', hint: 'Clear their desk so they take new work', danger: true, onSelect: () => void clearDeskOf(alarm.agentId!) }]} />
        )}
      </Actions>
    </Section>
  );
}

const FIXES: Record<DoctorFix, [string, string]> = {
  clear: ['Clear desk', 'Clear their desk so they take new work'],
  stop: ['Stop', 'Stop their session'],
  requeue: ['Requeue', 'Stop them and put the work back in line, without a strike'],
  'retry-qa': ['Retry QA', 'Queue the PR for a fresh QA run'],
  'send-back': ['Send back for a fix', 'Hand the PR to its author, or any free agent'],
  'close-issue': ['Close issue', 'Close the issue on GitHub as completed'],
};

/** The icon beside a fix's button, where one makes it clearer. */
const FIX_ICON: Partial<Record<DoctorFix, IconName>> = { clear: 'rotate-ccw', stop: 'square', requeue: 'reply' };

/** Fixes that are hard to undo: they go in the card's ⋯ and confirm first (docs/design.md). */
const RISKY: DoctorFix[] = ['clear', 'close-issue'];

const clearDeskOf = (id: string) => {
  const a = useStore.getState().agents[id];
  return a ? clearDesk(a) : Promise.resolve(false);
};

async function applyFix(f: DoctorFinding, fix: DoctorFix) {
  if (RISKY.includes(fix) && document.pointerLockElement) document.exitPointerLock();
  if (fix === 'clear') {
    const ok = await confirmDialog({
      icon: 'rotate-ccw',
      tone: 'danger',
      title: 'Clear their desk?',
      body: 'They drop the task they had and take new work.',
      confirm: 'Clear desk',
    });
    if (!ok) return;
  }
  if (fix === 'close-issue') {
    const ok = await confirmDialog({
      icon: 'stethoscope',
      tone: 'danger',
      title: `Close issue #${f.issueNumber}?`,
      body: <p>It's closed on GitHub as completed, with a comment saying PR #{f.prNumber} resolved it.</p>,
      confirm: 'Close issue',
    });
    if (!ok) return;
  }
  await attempt(() => api.doctorFix(f.id, fix));
}

function DoctorCard({ finding: f, repo }: { finding: DoctorFinding; repo: RepoView | undefined }) {
  const openOverlay = useStore((s) => s.openOverlay);
  return (
    <Section id={`ops-card-doctor-${f.id}`} tone="warn" title={
        <>
          <Icon name="stethoscope" /> {f.text}
        </>
      }
    >
      <div className="dp-meta">
        Floor {repo?.floor ?? '?'} · {repo?.fullName ?? f.repoId} · since {new Date(f.since).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
      </div>
      <Actions>
        {f.fixes
          .filter((fix) => !RISKY.includes(fix))
          .map((fix, i) => (
            <button key={fix} className={`ds-btn ${i === 0 ? '' : 'ds-btn-ghost'}`} title={FIXES[fix][1]} onClick={() => void applyFix(f, fix)}>
              {FIX_ICON[fix] && <Icon name={FIX_ICON[fix]!} />} {FIXES[fix][0]}
            </button>
          ))}
        {f.agentId && (
          <button className="ds-btn" onClick={() => openOverlay({ kind: 'terminal', agentId: f.agentId! })}>
            Terminal
          </button>
        )}
        <button className="ds-btn ds-btn-ghost" title="Hide it until it goes away" onClick={() => void attempt(() => api.doctorIgnore(f.id))}>
          Ignore
        </button>
        {f.fixes.some((fix) => RISKY.includes(fix)) && (
          <Menu
            label="More fixes"
            title={f.text}
            items={f.fixes.filter((fix) => RISKY.includes(fix)).map((fix) => ({ label: `${FIXES[fix][0]}…`, hint: FIXES[fix][1], danger: true, onSelect: () => void applyFix(f, fix) }))}
          />
        )}
      </Actions>
    </Section>
  );
}

async function demoDoctor(action: Parameters<typeof api.demoDoctor>[0]) {
  const r = await attempt(() => api.demoDoctor(action));
  if (r) useStore.getState().pushToast('info', r.text);
}

function DoctorSection({ hot }: { hot: boolean }) {
  const doctor = useStore((s) => s.doctor);
  const repos = useStore((s) => s.repos);
  const demo = useStore((s) => s.demo);
  return (
    <div id="ops-card-doctor" className={hot ? 'ops-card-hot' : ''}>
      <h3 className="section">
        <Icon name="stethoscope" /> Office doctor {doctor.length > 0 && <span className="badge">{doctor.length}</span>}
      </h3>
      {doctor.length === 0 && (
        <p className="muted small">Nothing stuck. Every minute the watchdog nudges quiet sessions, frees stuck desks and puts orphaned work back in line by itself; what it can't safely fix shows up here.</p>
      )}
      {doctor.map((f) => (
        <DoctorCard key={f.id} finding={f} repo={repos.find((r) => r.id === f.repoId)} />
      ))}
      {demo && (
        <div className="row wrap">
          <span className="muted small">Demo:</span>
          <button className="btn btn-small btn-ghost" title="Restart with desks gone and work finished on GitHub meanwhile" onClick={() => void demoDoctor('restart')}>
            Simulate a restart
          </button>
          <button className="btn btn-small btn-ghost" title="Someone's session goes quiet for 20 minutes" onClick={() => void demoDoctor('stuck')}>
            Make a session stuck
          </button>
          <button className="btn btn-small btn-ghost" title="Ten more minutes pass for the stuck sessions" onClick={() => void demoDoctor('later')}>
            10 minutes later
          </button>
          <button className="btn btn-small btn-ghost" title="A merged PR whose issue was never closed" onClick={() => void demoDoctor('unclosed')}>
            Leave an issue open
          </button>
        </div>
      )}
    </div>
  );
}

const COLUMNS: [string, (n: OpsNumbers) => string, string?][] = [
  ['Ready', (n) => String(n.ready), 'Backlog issues that can start now'],
  ['Building', (n) => String(n.building)],
  ['In QA', (n) => String(n.inQa)],
  ['Fixing', (n) => String(n.fixing), 'Back with an agent: QA findings, checks or a conflict'],
  ['To merge', (n) => String(n.toMerge)],
  ['Needs you', (n) => `${n.needsYou}${n.triage ? ` (+${n.triage})` : ''}`, 'The number in parentheses: the CEO is looking first'],
  ['Longest wait for you', (n) => fmtDuration(n.longestWaitMs), 'The longest a PR has waited in needs-you right now (the CEO looking included); target under 30 minutes'],
  ['Merged today', (n) => `${n.mergedToday} (${n.mergedHour} last hour)`],
  ['Lead time', (n) => fmtDuration(n.leadMs), 'Median issue → merge over the last 24 hours'],
  ['QA wait', (n) => fmtDuration(n.qaWaitMs), 'Median wait for a free agent over the last 24 hours'],
  [
    'QA first pass',
    (n) => (n.qaRoundsPerMerge === null ? fmtPct(n.qaFirstPass) : `${fmtPct(n.qaFirstPass)} · ${n.qaRoundsPerMerge.toFixed(1)} rounds/merge`),
    'Over 7 days: PRs whose first QA round passed · average QA rounds per merged PR',
  ],
  ['Lab errors', (n) => String(n.qaLabErrors), 'QA rounds the test lab failed over 7 days (no browser, out of memory, went silent): not counted as failed rounds'],
  ['CI', (n) => (n.ciRuns ? `${fmtPct(n.ciPass)} · ${fmtDuration(n.ciMs)}` : '—'), "GitHub's checks over 7 days: pass rate · median time"],
  ['Team', (n) => `${n.busy} busy · ${n.idle} idle${n.errors ? ` · ${n.errors} error` : ''}`],
  ['Cost today', (n) => `~${fmtUsd(n.costToday)}`, "An estimate from finished sessions' reported cost"],
];

function OpsTable() {
  const ops = useStore((s) => s.ops);
  const repos = useStore((s) => s.repos);
  const rows: [string, string, OpsNumbers][] = [
    ...ops.floors.map((f): [string, string, OpsNumbers] => {
      const r = repos.find((x) => x.id === f.repoId);
      return [`${f.floor} · ${r?.fullName.split('/')[1] ?? f.repoId}`, r?.color ?? '#ccc', f];
    }),
    ['All floors', '#1f1d2b', ops.total],
  ];
  return (
    <div className="ops-table-wrap" tabIndex={0} role="region" aria-label="The numbers, per floor">
      <table className="ops-table">
        <thead>
          <tr>
            <th />
            {rows.map(([name, color]) => (
              <th key={name} style={{ ['--accent' as string]: color }} className="ops-col">
                {name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {COLUMNS.map(([label, value, tip]) => (
            <tr key={label}>
              <th title={tip}>{label}</th>
              {rows.map(([name, , n]) => (
                <td key={name}>{value(n)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {ops.ceoCostToday > 0 && <div className="muted small">The CEO's sessions today: ~{fmtUsd(ops.ceoCostToday)} (in All floors' cost).</div>}
    </div>
  );
}

export function OpsTab({ card }: { card?: string }) {
  const alarms = useStore((s) => s.ops.alarms);
  const repos = useStore((s) => s.repos);
  useEffect(() => {
    if (card) document.getElementById(`ops-card-${card}`)?.scrollIntoView({ block: 'center' });
  }, [card]);
  return (
    <div className="tab-grid ops-grid">
      <div>
        <Section
          id="ops-card-sources"
          title={
            <span className="dp-chips">
              <Icon name="gauge" /> Usage
            </span>
          }
        >
          <UsageSources />
        </Section>
        <UsageCard hot={card === 'usage'} />
        <HealthStrip />
        <ServerCard />
        <CloudToday />
        <TestLabCard />
        <WaitTile />
        <h3 className="section">
          <Icon name="siren" /> Needs you {alarms.length > 0 && <span className="badge">{alarms.length}</span>}
        </h3>
        {alarms.length === 0 && <p className="muted small">All clear. The beacon on the lobby's mission control wall spins when a PR needs you or an agent has been stuck on an error for 10 minutes.</p>}
        {alarms.map((a) => (
          <AlarmCard key={a.id} alarm={a} repo={repos.find((r) => r.id === a.repoId)} hot={a.id === card} />
        ))}
        <DoctorSection hot={card === 'doctor'} />
        <ManagerChangesCard />
      </div>
      <div>
        <FloorProgress />
        <h3 className="section">
          <Icon name="satellite" /> The numbers
        </h3>
        <OpsTable />
        <CostsSection />
        <ExperimentsSection />
      </div>
    </div>
  );
}
