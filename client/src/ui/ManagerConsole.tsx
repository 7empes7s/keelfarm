import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { TeamStats } from './CareerCard';
import { api } from '../api';
import { PreviewPill, PreviewSettings } from './AppViewer';
import { agentsOnRepo, pendingRequests, useStore } from '../store';
import { CEO_ID, PLAYBOOK_MAX, type AgentCli, type EffortLevel, type OfficeUpdateView, type RepoView } from '../../../shared/types';
import { modelSuggestions } from '../../../shared/models';
import { CliOptions, CliSelect, cliName, EFFORTS, EffortSelect, LookEditor, LookSelect, ModelInput, NameInput, PromptPreview } from './AgentSettings';
import { canPostpone, canUpdateNow, drainDeadline, officeUpdateText } from '../officeUpdate';
import { confirmDialog } from './Confirm';
import { letGo } from './dangerActions';
import { IssueForm } from './KanbanView';
import { LiveTerminal } from './LiveTerminal';
import { MicButton } from './MicButton';
import { Menu } from './Menu';
import { Resume } from './Phone';
import { ProjectPicker } from './ProjectPicker';
import { badgeStatus, StatusPill } from './StatusPill';
import { CeoMandates, CeoSession } from './CeoFollowups';
import { FloorPractices } from './PracticesSettings';
import { OfficePlaybook } from './OfficePlaybook';
import { useMode } from '../pocket/mode';

// The console's work sections (floors, the CEO, the team, issues); ConsoleView.tsx puts them in their tabs.

async function attempt<T>(fn: () => Promise<T>): Promise<T | undefined> {
  try {
    return await fn();
  } catch {
    return undefined; // api() already toasted the error
  }
}

// ---------- floors ----------

const NO_LAUNCHER = 'Start the office with npm run dev or npm start so it can install updates and restart itself.';

/** The office itself: the commit it runs and its own update. Hidden on servers that can't update themselves. */
function OfficeRow({ update }: { update: OfficeUpdateView }) {
  const commit = useStore((s) => s.officeCommit);
  const autoUpdate = useStore((s) => s.settings.autoUpdate);
  const [busy, setBusy] = useState(false);
  const act = (action: 'now' | 'later') => {
    setBusy(true);
    void attempt(() => api.updateOffice(action)).finally(() => setBusy(false));
  };
  const deadline = drainDeadline(update);
  const pending = update.state !== 'none';
  const tone = update.state === 'failed' ? 'office-state-bad' : update.state === 'none' ? 'office-state-ok' : 'office-state-busy';
  const tip = (enabled: boolean, text: string) => (update.launcher ? (enabled ? text : undefined) : NO_LAUNCHER);
  return (
    <div className="card office-card">
      <div className="row wrap">
        <span className="floor-badge office-badge" aria-hidden>
          🏢
        </span>
        <div className="grow">
          <b>Office</b> <span className="muted small">running {commit ? <code>{commit}</code> : 'an unknown commit'}</span>
          <div className={`small office-state ${tone}`} role="status">
            {officeUpdateText(update)}
          </div>
        </div>
        {pending && (
          <div className="office-actions" title={update.launcher ? undefined : NO_LAUNCHER}>
            <button
              className="btn btn-small btn-good"
              disabled={busy || !canUpdateNow(update)}
              title={tip(canUpdateNow(update), 'Update without waiting for more merges: agents keep working while it is checked, then the office restarts for a few seconds')}
              onClick={() => act('now')}
            >
              Update now
            </button>
            <button className="btn btn-small btn-ghost" disabled={busy || !canPostpone(update)} title={tip(canPostpone(update), 'Keep working; ask again in 2 hours or when a newer commit lands')} onClick={() => act('later')}>
              Later
            </button>
          </div>
        )}
      </div>
      {update.detail && update.state !== 'failed' && <div className="muted small">{update.detail}</div>}
      {deadline && update.running > 0 && (
        <div className="muted small">Sessions a restart would stop that are still running at {new Date(deadline).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} are stopped, and their work goes back to the queue.</div>
      )}
      {!update.launcher && pending && <div className="muted small">{NO_LAUNCHER}</div>}
      {typeof autoUpdate === 'boolean' && (
        <label className="toggle" title="When merges have settled, check the update while agents keep working, then restart the office for a few seconds">
          <input type="checkbox" checked={autoUpdate} onChange={(e) => void attempt(() => api.updateSettings({ autoUpdate: e.target.checked }))} /> Update automatically
        </label>
      )}
    </div>
  );
}

function FloorRow({ repo, all }: { repo: RepoView; all: RepoView[] }) {
  const agents = useStore((s) => s.agents);
  const pocket = useMode((s) => s.mode === 'pocket');
  const goToFloor = useStore((s) => s.goToFloor);
  const openOverlay = useStore((s) => s.openOverlay);
  // The office's own folder isn't fast-forwarded; its update is on the Office row instead.
  const officeFolder = useStore((s) => !!s.officeUpdate) && !!repo.folderSync?.startsWith('update ready');
  const team = agentsOnRepo(agents, repo.id);
  const others = all.filter((r) => r.id !== repo.id);
  const patch = (p: Parameters<typeof api.updateRepo>[1]) => void attempt(() => api.updateRepo(repo.id, p));
  const disconnect = () =>
    void confirmDialog({
      tone: 'danger',
      title: `Disconnect ${repo.fullName}?`,
      body: `Everyone on this floor is let go. Nothing is deleted on GitHub, and ${repo.localPath ? 'your folder stays exactly as it is' : 'the local clone stays on disk'}.`,
      confirm: 'Disconnect',
    }).then((ok) => ok && attempt(() => api.disconnectRepo(repo.id)));
  return (
    <div className="card floor-card" style={{ ['--accent' as string]: repo.color }}>
      <div className="ds-card-head">
        <span className="floor-badge">{repo.floor}</span>
        <div className="ds-row-main">
          <a className="ds-row-title floor-name" href={repo.url} target="_blank" rel="noreferrer" title={repo.fullName}>
            {repo.fullName}
          </a>
          {repo.summary && <div className="ds-row-meta">🧠 {repo.summary}</div>}
        </div>
        {!pocket && (
          <button className="btn btn-small" onClick={() => goToFloor(repo.floor)}>
            Visit
          </button>
        )}
        <Menu
          label={`Manage floor ${repo.floor}`}
          title={repo.fullName}
          items={[
            { label: '⟳ Sync the folder now', hint: "Fast-forward it to GitHub's default branch, when that's safe", onSelect: () => void attempt(() => api.syncFolder(repo.id)) },
            { label: 'Disconnect…', hint: 'Everyone on this floor is let go', danger: true, onSelect: disconnect },
          ]}
        />
      </div>
      <div className="ds-row-meta">
        {team.length} agents · {repo.issues.length} open issues · {repo.pulls.filter((p) => p.state === 'OPEN').length} open PRs
        {repo.cloneStatus !== 'ready' && ` · checkout: ${repo.cloneStatus}`}
      </div>
      <details className="small">
        <summary>Details</summary>
        <div className="ds-row-meta" title={repo.localPath ? 'Your own project folder' : 'A clone the office manages'}>
          📁 <code>{repo.checkoutPath}</code> · default branch <code>{repo.defaultBranch}</code>
          {officeFolder ? " · the office's own folder, updated from the Office row" : repo.folderSync && <span title={repo.folderSync}> · {repo.folderSync}</span>}
        </div>
      </details>
      {repo.cloneError && <div className="term-error small">clone failed: {repo.cloneError}</div>}
      {repo.syncError && <div className="term-error small">sync failed: {repo.syncError}</div>}
      <div className="ds-switches">
        <label className="toggle floor-colour">
          <input type="color" value={repo.color} onChange={(e) => patch({ color: e.target.value })} aria-label={`Floor ${repo.floor} colour`} /> 🎨 Floor colour
        </label>
        <label className="toggle">
          <input type="checkbox" checked={repo.autoAssign} onChange={(e) => patch({ autoAssign: e.target.checked })} /> ⚡ Auto-assign issues
        </label>
        <label className="toggle" title="Merge a PR as soon as QA has signed off on its latest commit and GitHub's checks are green">
          <input type="checkbox" checked={repo.autoMerge} onChange={(e) => patch({ autoMerge: e.target.checked })} /> 🔀 Auto-merge
        </label>
        <label className="toggle">
          <input type="checkbox" checked={repo.browserTesting} onChange={(e) => patch({ browserTesting: e.target.checked })} /> 🌐 Browser testing (Playwright MCP)
        </label>
      </div>
      {others.length > 0 && (
        <div className="ds-switches links">
          <span className="ds-row-meta">🔗 Agents here may read:</span>
          {others.map((o) => (
            <label key={o.id} className="toggle small">
              <input
                type="checkbox"
                checked={repo.links.includes(o.id)}
                onChange={(e) => patch({ links: e.target.checked ? [...repo.links, o.id] : repo.links.filter((l) => l !== o.id) })}
              />
              {o.fullName}
            </label>
          ))}
        </div>
      )}
      <details className="small preview-details">
        <summary>
          🖥️ App preview · <PreviewPill status={repo.preview.status} />
          {repo.previewConfig.command ? (
            <>
              {' '}
              <code>{repo.previewConfig.command}</code>
            </>
          ) : (
            ' auto-detected command'
          )}
        </summary>
        <PreviewSettings repo={repo} />
        <button className="btn btn-small" onClick={() => openOverlay({ kind: 'app', repoId: repo.id })}>
          Open the app viewer
        </button>
      </details>
      <FloorPractices repo={repo} />
    </div>
  );
}

export function FloorsTab() {
  const repos = useStore((s) => s.repos);
  const officeUpdate = useStore((s) => s.officeUpdate);
  return (
    <div className="tab-grid">
      <div>
        {officeUpdate && <OfficeRow update={officeUpdate} />}
        <h3 className="section">🏢 Floors</h3>
        {repos.length === 0 && <p className="muted">No floors yet. Add a project →</p>}
        {[...repos].sort((a, b) => a.floor - b.floor).map((r) => (
          <FloorRow key={r.id} repo={r} all={repos} />
        ))}
      </div>
      <div className="card">
        <h3>➕ Add a project</h3>
        <ProjectPicker />
      </div>
    </div>
  );
}

// ---------- CEO ----------

function FloorBrief({ repo }: { repo: RepoView }) {
  const [mission, setMission] = useState(repo.mission);
  const [research, setResearch] = useState(false);
  useEffect(() => setMission(repo.mission), [repo.mission]);
  return (
    <div className="card floor-card" style={{ ['--accent' as string]: repo.color }}>
      <div className="ds-card-head">
        <span className="floor-badge">{repo.floor}</span>
        <div className="ds-row-main">
          <b className="ds-row-title" title={repo.fullName}>
            {repo.fullName}
          </b>
          <div className="ds-row-meta">{repo.summary ? `🧠 ${repo.summary}` : 'The CEO has not studied this floor yet.'}</div>
        </div>
        <button className="btn btn-small btn-ghost" onClick={() => void attempt(() => api.onboardFloor(repo.id))} title="Study the repo again and rethink the plan and the team's size">
          Re-study
        </button>
      </div>
      <textarea value={mission} onChange={(e) => setMission(e.target.value)} rows={2} placeholder="Brief: what should this floor build next? The CEO turns it into issues and a team size." />
      <div className="row wrap">
        <button className="btn btn-small" disabled={mission === repo.mission} onClick={() => void attempt(() => api.updateRepo(repo.id, { mission }))}>
          Save brief
        </button>
        <span className="spacer" />
        <label className="toggle small" title="The CEO looks at current docs, how others do it and your connected apps first, and brings you options with sources. Your pick becomes the plan.">
          <input type="checkbox" checked={research} onChange={(e) => setResearch(e.target.checked)} />
          <span>🔎 Research first</span>
        </label>
        <button className="btn btn-small btn-good" disabled={!mission.trim()} onClick={() => void attempt(() => api.planFloor(repo.id, mission, research))}>
          {research ? '🔎 Ask the CEO to research it' : '🧠 Ask the CEO to plan it'}
        </button>
      </div>
      <details className="small">
        <summary>QA brief{repo.qaBrief ? '' : ' (none yet)'}</summary>
        <textarea
          key={repo.qaBrief}
          rows={4}
          defaultValue={repo.qaBrief}
          placeholder="What every QA pass must check on this project."
          onBlur={(e) => e.target.value !== repo.qaBrief && void attempt(() => api.updateRepo(repo.id, { qaBrief: e.target.value }))}
        />
      </details>
      <details className="small">
        <summary>Playbook{repo.playbook ? '' : ' (none yet)'}</summary>
        <textarea
          key={repo.playbook}
          rows={8}
          maxLength={PLAYBOOK_MAX}
          defaultValue={repo.playbook}
          placeholder="For every agent on this floor: where things live and what must not depend on what, conventions, the skills to use for this stack, known traps."
          onBlur={(e) => e.target.value !== repo.playbook && void attempt(() => api.updateRepo(repo.id, { playbook: e.target.value }))}
        />
      </details>
    </div>
  );
}

export function CeoTab() {
  const ceo = useStore((s) => s.agents[CEO_ID]);
  const log = useStore((s) => s.logs[CEO_ID]) ?? [];
  const info = useStore((s) => s.ceo);
  const repos = useStore((s) => s.repos);
  const requests = useStore((s) => s.requests);
  const openOverlay = useStore((s) => s.openOverlay);
  const [text, setText] = useState('');
  const scroller = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [log.length]);
  if (!ceo) return <p className="muted">The corner office is empty.</p>;
  const working = ceo.status === 'working';
  const pending = pendingRequests(requests);
  const send = (t: string) => {
    if (!t.trim()) return;
    setText('');
    void attempt(() => api.messageCeo(t));
  };
  const decided = requests.filter((r) => r.status !== 'pending').slice(-6).reverse();
  return (
    <div className="tab-grid">
      <div>
        <div className="card">
          <div className="ds-card-head">
            <span className="avatar" style={{ background: ceo.color }}>
              {ceo.name[0]}
            </span>
            <div className="ds-row-main ceo-name">
              <NameInput agent={ceo} style={{ fontWeight: 700 }} />
              <span className="muted small">CEO</span>
            </div>
            <StatusPill status={ceo.status} />
          </div>
          <div className="ds-fields">
            <label className="field">
              <span>Model</span>
              <ModelInput agent={ceo} className="" />
            </label>
            <label className="field">
              <span>Effort</span>
              <EffortSelect agent={ceo} />
            </label>
          </div>
          <div className="small">
            <b>Now:</b> {working ? info.job?.label : 'free'}
            {info.queue.length > 0 && (
              <>
                {' '}
                · <b>Up next:</b> {info.queue.map((j) => j.label).join(' → ')}
              </>
            )}
          </div>
          <div className="muted small">
            {info.nextReviewAt ? `Next company review around ${new Date(info.nextReviewAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} (skipped if nothing changed).` : 'Periodic reviews are off (CEO settings).'}
          </div>
          <PromptPreview agent={ceo} />
          {ceo.terminal ? (
            <LiveTerminal agentId={ceo.id} className="ceo-term" />
          ) : (
            <div className="term ceo-term" ref={scroller}>
              {log.length === 0 && <div className="term-line term-system">(nothing yet)</div>}
              {log.map((l) => (
                <div key={l.id} className={`term-line term-${l.kind}`}>
                  {l.text || ' '}
                </div>
              ))}
            </div>
          )}
          <form
            className="ds-compose"
            onSubmit={(e) => {
              e.preventDefault();
              send(text);
            }}
          >
            <input value={text} onChange={(e) => setText(e.target.value)} placeholder={`Message ${ceo.name}…`} aria-label={`Message ${ceo.name}`} />
            <MicButton kind="console" value={text} onChange={setText} onSend={send} />
            <button className="btn" disabled={!text.trim()}>
              Send
            </button>
          </form>
          <div className="row wrap">
            {working && (
              <button className="btn btn-small btn-bad" onClick={() => void attempt(() => api.stop(ceo.id))}>
                ■ Stop
              </button>
            )}
            <button className="btn btn-small" disabled={repos.length === 0} onClick={() => void attempt(() => api.ceoReview())}>
              🔎 Review the company now
            </button>
            <button className="btn btn-small" onClick={() => openOverlay({ kind: 'phone', tab: 'chat' })}>
              📱 Open the phone
            </button>
          </div>
        </div>
      </div>
      <div>
        <CeoSession />
        <CeoMandates />
        <h3 className="section">📄 Team changes {pending.length > 0 && <span className="badge">{pending.length}</span>}</h3>
        {pending.length === 0 && <p className="muted small">None waiting. The CEO grows or shrinks a floor's team when its work calls for it (CEO settings → Team changes from the CEO).</p>}
        {pending.map((r) => (
          <Resume key={r.id} req={r} />
        ))}
        {decided.length > 0 && (
          <details className="small" style={{ marginBottom: 12 }}>
            <summary>Recent decisions</summary>
            {decided.map((r) => (
              <Resume key={r.id} req={r} />
            ))}
          </details>
        )}
        <h3 className="section">🗺️ Project briefs</h3>
        <OfficePlaybook />
        {repos.length === 0 && <p className="muted small">Connect a repo first.</p>}
        {[...repos].sort((a, b) => a.floor - b.floor).map((r) => (
          <FloorBrief key={r.id} repo={r} />
        ))}
      </div>
    </div>
  );
}

// ---------- team ----------

interface NewAgent {
  name: string;
  cli: AgentCli | '';
  model: string;
  effort: EffortLevel | '';
}

const NO_SETUP: NewAgent = { name: '', cli: '', model: '', effort: '' };

/** A floor's "+ Agent": an optional name and their coding agent, model and effort ('' = the office's defaults). */
function AddAgent({ repo, size }: { repo: RepoView; size: number }) {
  const settings = useStore((s) => s.settings);
  const clis = useStore((s) => s.clis);
  const [draft, setDraft] = useState<NewAgent>(NO_SETUP);
  const [busy, setBusy] = useState(false);
  const terminal = settings.runtime === 'terminal';
  const cli = terminal ? draft.cli || settings.defaultCli : 'claude';
  const full = size >= settings.maxAgents;
  const edit = (p: Partial<NewAgent>) => setDraft({ ...draft, ...p });
  const add = () => {
    setBusy(true);
    const { name, ...setup } = draft;
    void attempt(() => api.hireAgent(repo.id, { ...setup, name: name.trim() || undefined }))
      .then((a) => a && setDraft(NO_SETUP))
      .finally(() => setBusy(false));
  };
  return (
    <div className="ds-fields add-agent">
      <input value={draft.name} onChange={(e) => edit({ name: e.target.value })} placeholder="Name (optional)" maxLength={24} aria-label={`New agent's name on floor ${repo.floor}`} />
      {terminal && (
        <select value={draft.cli} onChange={(e) => edit({ cli: e.target.value as AgentCli | '' })} aria-label="New agent's coding agent">
          <option value="">{cliName(clis, settings.defaultCli)} (default)</option>
          <CliOptions clis={clis} />
        </select>
      )}
      <input value={draft.model} onChange={(e) => edit({ model: e.target.value })} list={`new-agent-models-${repo.floor}`} placeholder="default model" aria-label="New agent's model" />
      <datalist id={`new-agent-models-${repo.floor}`}>
        {modelSuggestions(cli).map((m) => (
          <option key={m} value={m} />
        ))}
      </datalist>
      <select value={draft.effort} onChange={(e) => edit({ effort: e.target.value as EffortLevel | '' })} aria-label="New agent's effort">
        <option value="">default effort ({settings.defaultEffort})</option>
        {EFFORTS.map((x) => (
          <option key={x} value={x}>
            {x}
          </option>
        ))}
      </select>
      <span className="add-agent-go" title={full ? `Floor ${repo.floor} has its most agents (${settings.maxAgents}): change it in Settings → Agents → Most agents per floor` : undefined}>
        <button className="btn btn-small btn-good" disabled={busy || full} onClick={add}>
          + Agent
        </button>
      </span>
    </div>
  );
}

export function TeamTab() {
  const repos = useStore((s) => s.repos);
  const agents = useStore((s) => s.agents);
  const settings = useStore((s) => s.settings);
  const openOverlay = useStore((s) => s.openOverlay);
  const terminal = settings.runtime === 'terminal';
  const [openLook, setOpenLook] = useState<string | null>(null);
  if (repos.length === 0) return <p className="muted">Connect a repo first; agents need a floor to sit on.</p>;
  return (
    <div>
      {[...repos].sort((a, b) => a.floor - b.floor).map((repo) => {
        const team = agentsOnRepo(agents, repo.id).filter((a) => a.role !== 'ceo');
        return (
          <div key={repo.id} className="card floor-card" style={{ ['--accent' as string]: repo.color }}>
            <div className="ds-card-head">
              <span className="floor-badge">{repo.floor}</span>
              <b className="ds-row-main ds-row-title" title={repo.fullName}>
                {repo.fullName}
              </b>
              <span className="muted small nowrap">
                {team.length} of {settings.maxAgents} agents
              </span>
            </div>
            <AddAgent repo={repo} size={team.length} />
            {team.length === 0 && <div className="muted small">No one works here yet.</div>}
            <table className="team ds-table roster">
              <tbody>
                {team.map((a) => (
                  <Fragment key={a.id}>
                    <tr>
                      <td className="ds-cell-head">
                        <span className="dot" style={{ background: a.color }} />
                        <NameInput agent={a} />
                        {a.host === 'box' && (
                          <span className="cloud-badge" title="Works in an Upstash Box: carries on when the office is closed">
                            ☁
                          </span>
                        )}
                        <StatusPill status={badgeStatus(a)} />
                      </td>
                      <td className="small ds-cell-full roster-doing">
                        {a.status === 'idle' ? '' : a.task === 'qa' ? `testing PR #${a.prNumber}` : a.task === 'fix' ? `fixing PR #${a.prNumber}` : `#${a.issueNumber ?? ''} ${a.issueTitle ?? ''}`}
                      </td>
                      {terminal && (
                        <td data-label="Coding agent">
                          <CliSelect agent={a} />
                        </td>
                      )}
                      <td data-label="Model">
                        <ModelInput agent={a} className="" />
                      </td>
                      <td data-label="Effort">
                        <EffortSelect agent={a} />
                      </td>
                      <td className="ds-cell-full">
                        <div className="ds-row-actions">
                          {a.host === 'box' && a.needsSignIn && (
                            <button className="btn btn-small btn-good" title={`${a.name}'s cloud machine needs you to sign their coding agent in`} onClick={() => openOverlay({ kind: 'terminal', agentId: a.id })}>
                              🔑 Sign in
                            </button>
                          )}
                          <button className="btn btn-small" onClick={() => openOverlay({ kind: 'terminal', agentId: a.id })}>
                            Terminal
                          </button>
                          <button className="btn btn-small btn-ghost" aria-expanded={openLook === a.id} title={`${a.name}'s look`} onClick={() => setOpenLook(openLook === a.id ? null : a.id)}>
                            🎨 Look
                          </button>
                          <Menu label={`More for ${a.name}`} title={a.name} items={[{ label: `Let ${a.name} go…`, hint: 'Their worktree is removed', danger: true, onSelect: () => void letGo(a) }]} />
                        </div>
                      </td>
                    </tr>
                    {openLook === a.id && (
                      <tr className="roster-look">
                        <td className="ds-cell-full" colSpan={terminal ? 6 : 5}>
                          <label className="row small">
                            <span>Drawn as</span>
                            <LookSelect agent={a} />
                          </label>
                          <LookEditor agent={a} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        );
      })}
      <TeamStats />
    </div>
  );
}

// ---------- issues ----------

export function IssuesTab({ initialRepo }: { initialRepo?: string }) {
  const repos = useStore((s) => s.repos);
  const allAgents = useStore((s) => s.agents);
  const [repoId, setRepoId] = useState(initialRepo ?? repos[0]?.id ?? '');
  const repo = repos.find((r) => r.id === repoId);
  const agents = useMemo(() => agentsOnRepo(allAgents, repoId), [allAgents, repoId]);
  if (repos.length === 0) return <p className="muted">Connect a repo first.</p>;
  return (
    <div className="tab-grid">
      <div className="card">
        <h3>📝 File a new issue</h3>
        <select value={repoId} onChange={(e) => setRepoId(e.target.value)} aria-label="Floor">
          {repos.map((r) => (
            <option key={r.id} value={r.id}>
              Floor {r.floor} · {r.fullName}
            </option>
          ))}
        </select>
        {repo && <IssueForm key={repo.id} repoId={repo.id} agents={agents} />}
      </div>
      <div className="card">
        <h3>Open issues on {repo?.fullName}</h3>
        <div className="repo-list tall issue-list">
          {repo?.issues.length === 0 && <div className="muted small">None. Nice.</div>}
          {repo?.issues.map((i) => {
            const holder = agents.find((a) => a.role !== 'ceo' && a.task !== 'qa' && a.issueNumber === i.number && a.status !== 'idle');
            return (
              <div key={i.number} className="ds-row issue-row">
                <div className="ds-row-main">
                  <a href={i.url} target="_blank" rel="noreferrer">
                    #{i.number}
                  </a>{' '}
                  {i.title}
                  {i.labels.length > 0 && <div className="ds-row-meta">{i.labels.join(', ')}</div>}
                </div>
                <span className="ds-row-actions">
                  {holder ? (
                    <span className="agent-chip">
                      <span className="dot" style={{ background: holder.color }} />
                      {holder.name}
                    </span>
                  ) : (
                    <select value="" onChange={(e) => e.target.value && void attempt(() => api.assign(e.target.value, i.number))} aria-label={`Assign issue #${i.number}`}>
                      <option value="">Assign…</option>
                      {agents
                        .filter((a) => a.role !== 'ceo' && a.status !== 'working' && a.status !== 'preparing')
                        .map((a) => (
                          <option key={a.id} value={a.id}>
                            {a.name}
                          </option>
                        ))}
                    </select>
                  )}
                  <Menu
                    label={`More for issue #${i.number}`}
                    title={`#${i.number} ${i.title}`}
                    items={[
                      {
                        label: 'Close as not planned…',
                        hint: 'Closes it on GitHub',
                        danger: true,
                        onSelect: () =>
                          void confirmDialog({
                            tone: 'danger',
                            title: `Close #${i.number}?`,
                            body: `“${i.title}” will be closed on GitHub as not planned${holder ? `, and ${holder.name} stops working on it` : ''}.`,
                            confirm: 'Close issue',
                          }).then((ok) => ok && attempt(() => api.closeIssue(repo.id, i.number))),
                      },
                    ]}
                  />
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
