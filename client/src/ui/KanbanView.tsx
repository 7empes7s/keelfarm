import { useId, useMemo, useRef, useState } from 'react';
import { LabChip } from './ExperimentsSection';
import { LeaseChip } from './PracticesSettings';
import { api } from '../api';
import { agentsOnRepo, kanbanFor, useStore, type Agent, type KanbanCard } from '../store';
import { confirmDialog } from './Confirm';
import { Menu } from './Menu';
import { Panel } from './Panel';
import { HistoryButton } from './HistoryTab';
import { EmptyState } from './EmptyState';
import { InfoButton } from './InfoButton';
import type { EmptyKind } from './emptyStates';
import type { Target } from './goTo';
import { cardPhrase } from './statusPhrase';
import { FloorBuilds } from './FloorBuilds';
import { COLUMN_IDS, foldSummary, isFolded, parseFolds, withFold, type ColumnId, type FoldMap } from './kanbanFold';
import { useLayout } from '../pocket/mode';
import { reduceMotion } from './a11y';
import './kanbanFold.css';
import { TaskBar, taskSince } from './TaskProgress';
import { CiOutageBanner } from './CiOutageBanner';
import { TRUST_LABEL } from '../../../shared/trust';
import { HoverCard } from './HoverCard';
import { AgentPeek, QaPeek, WorkPeek } from './Peeks';

/** Who has the card; "QA" while they're testing it. */
function AgentChip({ agent, card }: { agent?: Agent; card: KanbanCard }) {
  if (!agent) return null;
  return (
    <HoverCard label={agent.name} peek={<AgentPeek agent={agent} />}>
      <span className="agent-chip" tabIndex={0}>
        <span className="dot" style={{ background: agent.color }} />
        {agent.name}
        {agent.task === 'qa' && card.prNumber != null && agent.prNumber === card.prNumber && <span className="chip">QA</span>}
      </span>
    </HoverCard>
  );
}

export function IssueForm({ repoId, agents, onDone }: { repoId: string; agents: Agent[]; onDone?: () => void }) {
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [assignTo, setAssignTo] = useState('');
  const [busy, setBusy] = useState(false);
  const free = agents.filter((a) => a.role !== 'ceo' && a.status !== 'working' && a.status !== 'preparing');
  return (
    <form
      className="issue-form"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!title.trim()) return;
        setBusy(true);
        try {
          await api.createIssue(repoId, title, body, assignTo || undefined);
          setTitle('');
          setBody('');
          setAssignTo('');
          onDone?.();
        } catch {
          // toasted
        } finally {
          setBusy(false);
        }
      }}
    >
      <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Issue title, e.g. Add a dark mode toggle" aria-label="Issue title" autoFocus />
      <textarea value={body} onChange={(e) => setBody(e.target.value)} placeholder="Describe what you want. Acceptance criteria help the agent who builds it and the one who tests it a lot." aria-label="Issue description" rows={5} />
      <div className="row">
        <select value={assignTo} onChange={(e) => setAssignTo(e.target.value)} aria-label="Who works on it">
          <option value="">Leave in backlog (auto-assign picks it up if enabled)</option>
          {free.map((a) => (
            <option key={a.id} value={a.id}>
              Give it to {a.name} right away
            </option>
          ))}
        </select>
        <button className="btn btn-good" disabled={busy || !title.trim()}>
          {busy ? 'Filing…' : 'File issue on GitHub'}
        </button>
      </div>
    </form>
  );
}

/** The board's frame: a panel over the office, or (in pocket mode) a plain section of the page. */
function Frame({ embedded, ...props }: Parameters<typeof Panel>[0] & { embedded?: boolean }) {
  if (!embedded) return <Panel {...props} />;
  return (
    <section className="kanban-embedded" style={{ ['--accent' as string]: props.accent }}>
      <h2 className="kanban-embedded-title">{props.title}</h2>
      {props.children}
    </section>
  );
}

const FOLD_KEY = 'cubefarm:kanban-fold';
const SHORT: Record<ColumnId, string> = { backlog: 'Backlog', progress: 'In progress', qa: 'In QA', ready: 'Ready', merged: 'Merged' };

function loadFolds(): FoldMap {
  try {
    return parseFolds(localStorage.getItem(FOLD_KEY));
  } catch {
    return {};
  }
}

function saveFolds(map: FoldMap) {
  try {
    localStorage.setItem(FOLD_KEY, JSON.stringify(map));
  } catch {
    // remembered for this visit only
  }
}

function QaLink({ card }: { card: KanbanCard }) {
  if (!card.qa?.commentUrl) return null;
  return (
    <HoverCard label={`QA on PR #${card.qa.prNumber}`} peek={<QaPeek qa={card.qa} />}>
      <a className="small" href={card.qa.commentUrl} target="_blank" rel="noreferrer">
        QA report ↗
      </a>
    </HoverCard>
  );
}

export function KanbanView({ repoId, embedded }: { repoId: string; embedded?: boolean }) {
  const repo = useStore((s) => s.repos.find((r) => r.id === repoId));
  const allAgents = useStore((s) => s.agents);
  const qaRecords = useStore((s) => s.qa);
  const usageState = useStore((s) => s.usage.state);
  const openOverlay = useStore((s) => s.openOverlay);
  const agents = useMemo(() => agentsOnRepo(allAgents, repoId), [allAgents, repoId]);
  const cols = useMemo(() => (repo ? kanbanFor(repo, agents, qaRecords, { state: usageState }) : null), [repo, agents, qaRecords, usageState]);
  const [showForm, setShowForm] = useState(false);
  const [pending, setPending] = useState<string | null>(null);
  // Folding (#154): a phone stacks the columns, so a folded one is its header (and the board comes before the builds);
  // side by side it's a narrow strip.
  const layout = useLayout();
  const phone = !!embedded && layout === 'compact';
  const strips = !embedded || layout === 'expanded';
  const [folds, setFolds] = useState(loadFolds);
  const foldId = useId();
  const colEls = useRef<Partial<Record<ColumnId, HTMLDivElement | null>>>({});

  if (!repo || !cols) {
    return (
      <Frame title="Kanban" embedded={embedded}>
        <p className="muted">This floor no longer exists.</p>
      </Frame>
    );
  }

  const act = async (key: string, fn: () => Promise<unknown>) => {
    setPending(key);
    try {
      await fn();
    } catch {
      // toasted
    } finally {
      setPending(null);
    }
  };
  const workers = agents.filter((a) => a.role !== 'ceo');
  const free = workers.filter((a) => a.status === 'idle' || a.status === 'done' || a.status === 'stopped' || a.status === 'error');
  const merge = async (c: KanbanCard) => {
    const passed = c.qa?.status === 'passed';
    const ok = await confirmDialog(
      passed
        ? { icon: '🎉', title: `Merge PR #${c.number}?`, body: `“${c.title}” passed QA. It will be squash-merged into ${repo.defaultBranch}.`, confirm: 'Squash & merge' }
        : {
            tone: 'warn',
            title: `Merge PR #${c.number} without QA?`,
            body: `“${c.title}” has not passed QA yet. Merge it into ${repo.defaultBranch} anyway?`,
            confirm: 'Merge anyway',
          },
    );
    if (ok) void act(c.key, () => api.mergePull(repo.id, c.number));
  };
  const sendBack = async (c: KanbanCard) => {
    let note = '';
    const ok = await confirmDialog({
      icon: '🔧',
      title: `Send PR #${c.number} back for a fix?`,
      body: (
        <>
          <p>Its author, or any free agent, fixes it with QA's findings, then it's tested once more.</p>
          <input
            maxLength={1000}
            placeholder="Optional note, e.g. merge main and keep both e2e tests"
            aria-label="Note for whoever fixes it"
            ref={(el) => void (el && setTimeout(() => el.focus(), 0))}
            onChange={(e) => (note = e.target.value)}
          />
        </>
      ),
      confirm: 'Send back',
    });
    if (ok) void act(c.key, () => api.sendBack(repo.id, c.number, note.trim() || undefined));
  };
  const trust = async (c: KanbanCard) => {
    const ok = await confirmDialog({
      tone: 'warn',
      icon: '🛡',
      title: `Trust issue #${c.number}?`,
      body: `“${c.title}” is from someone outside the team. Agents will build it as written, with a shell on this server: read it on GitHub first. The office adds the ${TRUST_LABEL} label, and the chat records that you let it in.`,
      confirm: 'Trust this issue',
    });
    if (ok) void act(c.key, () => api.trustIssue(repo.id, c.number));
  };
  const reviewOnGitHub = (c: KanbanCard) => (
    <a className="btn btn-small" href={c.url} target="_blank" rel="noreferrer">
      Review on GitHub ↗
    </a>
  );
  const closePr = async (c: KanbanCard) => {
    const ok = await confirmDialog({
      tone: 'danger',
      title: `Close PR #${c.number}?`,
      body: `“${c.title}” will be closed without merging, and any QA or fix work on it stops. Its issue stays open and waits for you to assign it again. The branch stays on GitHub.`,
      confirm: 'Close PR',
    });
    if (ok) void act(c.key, () => api.closePull(repo.id, c.number));
  };
  // Closing a PR is hard to undo: it sits in the card's ⋯ (docs/design.md).
  const closeButton = (c: KanbanCard) => (
    <Menu label={`More for PR #${c.number}`} title={`PR #${c.number} ${c.title}`} items={[{ label: 'Close PR…', hint: 'Closed without merging; the branch stays', danger: true, disabled: pending === c.key, onSelect: () => void closePr(c) }]} />
  );
  const previewButton = (c: KanbanCard) => (
    <button className="btn btn-small" title={`Run PR #${c.number} beside ${repo.defaultBranch} and open it in the app viewer`} onClick={() => openOverlay({ kind: 'app', repoId: repo.id, pr: c.number })}>
      Preview
    </button>
  );
  const terminalButton = (c: KanbanCard) =>
    c.agent && (
      <button className="btn btn-small" onClick={() => openOverlay({ kind: 'terminal', agentId: c.agent!.id })}>
        Terminal
      </button>
    );

  const nameOf = (id: string | null) => (id ? allAgents[id]?.name : undefined);
  const ask = (text: string): Target => ({ kind: 'ceo', text: text.replace('{floor}', `floor ${repo.floor} (${repo.fullName})`) });
  const emptyAction: Partial<Record<EmptyKind, { onAction?: () => void; target?: Target }>> = {
    backlog: { onAction: () => setShowForm(true) },
    progress: { target: ask('What should {floor} work on next?') },
    merged: { target: ask('Which pull request on {floor} is closest to merging, and what does it need?') },
  };
  // The card up close (CardView.tsx); closing it comes back to the board.
  const openCard = (c: KanbanCard) => {
    const back = useStore.getState().overlay;
    openOverlay({ kind: 'card', repoId: repo.id, key: c.key, number: c.number, pr: !!c.prNumber });
    useStore.setState({ back });
  };
  const folded = (id: ColumnId) => isFolded(folds, repo.id, id, phone);
  const fold = (id: ColumnId, shut: boolean) => {
    const next = withFold(folds, repo.id, id, shut);
    setFolds(next);
    saveFolds(next);
  };
  const jump = (id: ColumnId) => {
    fold(id, false);
    requestAnimationFrame(() => colEls.current[id]?.scrollIntoView({ block: 'start', behavior: reduceMotion() ? 'auto' : 'smooth' }));
  };
  const column = (title: string, cls: string, cards: KanbanCard[], render: (c: KanbanCard) => React.ReactNode, id: EmptyKind & ColumnId) => {
    const shut = folded(id);
    const summary = shut && foldSummary(id, cards);
    return (
      <div className={`kcol ${cls} ${shut ? 'kcol-shut' : ''}`} ref={(el) => void (colEls.current[id] = el)}>
        <button type="button" className="kcol-head" aria-expanded={!shut} aria-controls={`${foldId}-${id}`} onClick={() => fold(id, !shut)}>
          <span className="kcol-name">{title}</span> <span className="count">{cards.length}</span>
          {summary && <span className="kcol-summary">{summary}</span>}
          <span className="kcol-chev" aria-hidden="true">
            ›
          </span>
        </button>
        <div className="kcol-fold" id={`${foldId}-${id}`}>
          <div className="kcol-body">
            {cards.length === 0 && (
              <div className="kempty">
                <EmptyState kind={id} compact {...emptyAction[id]} />
              </div>
            )}
            {cards.map((c) => (
              <div key={c.key} className={`kcard ${c.tone ? `kcard-${c.tone}` : ''}`}>
                <div className="kcard-title">
                  <HoverCard label={`${c.prNumber ? 'PR' : 'Issue'} #${c.number}`} peek={<WorkPeek repo={repo} n={c.number} />}>
                    <button className="linkish" title="Open the card" onClick={() => openCard(c)}>
                      {c.prNumber ? 'PR ' : ''}#{c.number}
                    </button>
                  </HoverCard>{' '}
                  {c.title} <LabChip repoId={repo.id} issue={c.prNumber ? null : c.number} pr={c.prNumber ?? null} />
                  {!c.prNumber && <LeaseChip repo={repo} issue={c.number} />}
                </div>
                {cls !== 'kcol-merged' && cls !== 'kcol-backlog' && (
                  <TaskBar
                    input={c.prNumber != null ? { task: null, prNumber: c.prNumber, qa: c.qa } : { task: 'issue', status: c.agent?.status, prNumber: null }}
                    repoId={repo.id}
                    since={taskSince(repo, c.number, c.prNumber ?? null)}
                    name={`${c.prNumber ? 'PR' : 'Issue'} #${c.number}`}
                    compact
                    {...(c.url ? { href: c.url, tap: `Open ${c.prNumber ? 'the PR' : 'the issue'} on GitHub` } : c.agent ? { onClick: () => openOverlay({ kind: 'terminal', agentId: c.agent!.id }), tap: `Open ${c.agent.name}'s terminal` } : {})}
                  />
                )}
                {c.prNumber != null && cls !== 'kcol-merged' && !c.untrusted && (
                  <div className="muted small kcard-phrase">{cardPhrase(c.qa, repo.pulls.find((p) => p.number === c.prNumber), repo.autoMerge, nameOf)}</div>
                )}
                {render(c)}
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  };
  // side by side, a folded column's track is a strip; the open ones share the rest
  const tracks = strips && COLUMN_IDS.some(folded) ? COLUMN_IDS.map((id) => (folded(id) ? 'var(--kc-shut)' : 'var(--kc-open, minmax(210px, 1fr))')).join(' ') : undefined;

  return (
    <Frame
      embedded={embedded}
      wide
      accent={repo.color}
      title={
        <span>
          📋 {repo.fullName}{' '}
          <a className="small" href={repo.url} target="_blank" rel="noreferrer">
            GitHub ↗
          </a>
          {!embedded && <InfoButton screen="kanban" />}
        </span>
      }
    >
      <div className="kanban-toolbar">
        <button className="btn btn-good" onClick={() => setShowForm((v) => !v)}>
          {showForm ? 'Cancel' : '+ New issue'}
        </button>
        <label className="toggle">
          <input type="checkbox" checked={repo.autoAssign} onChange={(e) => void api.updateRepo(repo.id, { autoAssign: e.target.checked }).catch(() => undefined)} />
          ⚡ Auto-assign work to free agents
        </label>
        <label className="toggle" title="Merge a PR as soon as QA has signed off on its latest commit and GitHub's checks are green">
          <input type="checkbox" checked={repo.autoMerge} onChange={(e) => void api.updateRepo(repo.id, { autoMerge: e.target.checked }).catch(() => undefined)} />
          🔀 Auto-merge when QA and checks pass
        </label>
        <span className="spacer" />
        <button className="btn" onClick={() => openOverlay({ kind: 'app', repoId: repo.id })} title="Open this floor's running app">
          🖥️ View app
        </button>
        <span className="muted small">{repo.lastSync ? `Synced ${new Date(repo.lastSync).toLocaleTimeString()}` : 'Syncing…'}</span>
        <button className="btn" disabled={pending === 'sync'} onClick={() => act('sync', () => api.syncRepo(repo.id))}>
          ⟳ Sync
        </button>
      </div>
      {repo.syncError && <div className="term-error">⚠️ {repo.syncError}</div>}
      <CiOutageBanner repo={repo} />
      {showForm && <IssueForm repoId={repo.id} agents={workers} onDone={() => setShowForm(false)} />}
      {!phone && <FloorBuilds repoId={repo.id} />}

      {phone && (
        <nav className="kanban-jump" aria-label="Kanban columns">
          {COLUMN_IDS.map((id) => (
            <button key={id} type="button" className="kanban-jump-btn" onClick={() => jump(id)}>
              {SHORT[id]} <span className="count">{cols[id].length}</span>
            </button>
          ))}
        </nav>
      )}
      <div className={`kanban kanban-5 ${strips ? 'kanban-strips' : ''}`} style={tracks ? { gridTemplateColumns: tracks } : undefined}>
        {column(
          '📋 Backlog',
          'kcol-backlog',
          cols.backlog,
          (c) =>
            c.untrusted ? (
              <div className="kcard-foot">
                <span className="muted small">{c.note}</span>
                <span className="spacer" />
                <button className="btn btn-small" disabled={pending === c.key} onClick={() => void trust(c)}>
                  Trust this issue
                </button>
              </div>
            ) : (
            <div className="kcard-foot">
              {c.note && <span className="muted small">{c.note}</span>}
              <select
                value=""
                disabled={pending === c.key || free.length === 0}
                onChange={(e) => e.target.value && act(c.key, () => api.assign(e.target.value, c.number))}
                aria-label={`Assign issue #${c.number}`}
              >
                <option value="">{free.length ? 'Assign to…' : 'Everyone is busy'}</option>
                {free.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </div>
          ),
          'backlog',
        )}
        {column(
          '🔨 In progress',
          'kcol-progress',
          cols.progress,
          (c) => (
            <div className="kcard-foot">
              <AgentChip agent={c.agent} card={c} />
              <span className="muted small">{c.note}</span>
              <span className="spacer" />
              {terminalButton(c)}
            </div>
          ),
          'progress',
        )}
        {column(
          '🔍 In QA',
          'kcol-qa',
          cols.qa,
          (c) => {
            const st = c.qa?.status;
            if (c.untrusted) {
              return (
                <div className="kcard-foot">
                  <span className="muted small">{c.note}</span>
                  <span className="spacer" />
                  {reviewOnGitHub(c)}
                  {closeButton(c)}
                </div>
              );
            }
            return (
              <div className="kcard-foot">
                <AgentChip agent={c.agent} card={c} />
                <span className="muted small">{c.note}</span>
                <span className="spacer" />
                <QaLink card={c} />
                {previewButton(c)}
                <HistoryButton focus={{ repoId: repo.id, pr: c.number }} label={`The sessions on PR #${c.number}`} />
                {(st === 'testing' || st === 'fixing') && terminalButton(c)}
                {(!st || st === 'needs-human') && (
                  <button className="btn btn-small btn-good" disabled={pending === c.key} onClick={() => act(c.key, () => api.sendToQa(repo.id, c.number))}>
                    {st === 'needs-human' ? 'Retry QA' : 'Send to QA'}
                  </button>
                )}
                {(st === 'needs-human' || st === 'failed') && (
                  <button className="btn btn-small" disabled={pending === c.key} title="Hand it to its author, or any free agent, with QA's findings and your note, without another QA round first" onClick={() => sendBack(c)}>
                    Send back for a fix
                  </button>
                )}
                {st === 'needs-human' && (
                  <button className="btn btn-small btn-ghost" disabled={pending === c.key} onClick={() => merge(c)}>
                    Merge anyway
                  </button>
                )}
                {closeButton(c)}
              </div>
            );
          },
          'qa',
        )}
        {column(
          '✅ Ready to merge',
          'kcol-review',
          cols.ready,
          (c) => {
            const pr = repo.pulls.find((p) => p.number === c.prNumber);
            return (
              <div className="kcard-foot">
                <AgentChip agent={c.agent} card={c} />
                <span className="muted small">
                  {c.note}
                  {pr ? ` · +${pr.additions} −${pr.deletions}` : ''}
                </span>
                <span className="spacer" />
                <QaLink card={c} />
                {previewButton(c)}
                <HistoryButton focus={{ repoId: repo.id, pr: c.number }} label={`The sessions on PR #${c.number}`} />
                <button className="btn btn-small btn-good" disabled={pending === c.key || pr?.isDraft} onClick={() => merge(c)}>
                  Merge
                </button>
                {closeButton(c)}
              </div>
            );
          },
          'ready',
        )}
        {column(
          '🎉 Merged',
          'kcol-merged',
          cols.merged,
          (c) => (
            <div className="kcard-foot">
              <AgentChip agent={c.agent} card={c} />
            </div>
          ),
          'merged',
        )}
      </div>
      {phone && <FloorBuilds repoId={repo.id} />}
    </Frame>
  );
}
