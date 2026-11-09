import { useId, useMemo, useRef, useState } from 'react';
import { LabChip } from './ExperimentsSection';
import { LeaseChip } from './PracticesSettings';
import { api } from '../api';
import { agentsOnRepo, kanbanFor, useStore, type Agent, type KanbanCard } from '../store';
import { confirmDialog } from './Confirm';
import { Icon } from './Icon';
import type { IconName } from './icons';
import { Menu } from './Menu';
import { AssignButton } from './AssignSheet';
import { Panel } from './Panel';
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
import './kanbanCard.css';
import './kanbanHeader.css';
import { TaskBar, taskSince } from './TaskProgress';
import { CiOutageBanner } from './CiOutageBanner';
import { TRUST_LABEL } from '../../../shared/trust';
import { HoverCard } from './HoverCard';
import { useMinute } from './Decisions';
import { prWaitLine } from '../../../shared/approvals';
import { AgentPeek, WorkPeek } from './Peeks';
import { cardActions, cardState, DANGER, whoPhrase, type CardAction } from './cardActions';

/** Who has the card; "QA" while they're testing it. With `note`, the who row (#232): one line, the long form in its tooltip. */
function AgentChip({ agent, card, note }: { agent?: Agent; card: KanbanCard; note?: string }) {
  if (!agent) return note ? <span className="muted small kcard-who-text" title={note}>{whoPhrase(undefined, note).short}</span> : null;
  const who = whoPhrase(agent.name, note);
  return (
    <HoverCard label={agent.name} peek={<AgentPeek agent={agent} />}>
      <span className="agent-chip" tabIndex={0} title={note ? who.long : undefined}>
        <span className="dot" style={{ background: agent.color }} />
        {note ? <span className="kcard-who-text">{who.short}</span> : agent.name}
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
    <section className="kanban-embedded kanban-frame" style={{ ['--accent' as string]: props.accent }}>
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

export function KanbanView({ repoId, embedded }: { repoId: string; embedded?: boolean }) {
  const repo = useStore((s) => s.repos.find((r) => r.id === repoId));
  const allAgents = useStore((s) => s.agents);
  const qaRecords = useStore((s) => s.qa);
  const usageState = useStore((s) => s.usage.state);
  const now = useMinute(); // the cards' wait lines (#275)
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
  const merge = async (c: KanbanCard) => {
    const passed = c.qa?.status === 'passed';
    const ok = await confirmDialog(
      passed
        ? { icon: 'party-popper', title: `Merge PR #${c.number}?`, body: `“${c.title}” passed QA. It will be squash-merged into ${repo.defaultBranch}.`, confirm: 'Squash & merge' }
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
      icon: 'wrench',
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
      icon: 'shield',
      title: `Trust issue #${c.number}?`,
      body: `“${c.title}” is from someone outside the team. Agents will build it as written, with a shell on this server: read it on GitHub first. The office adds the ${TRUST_LABEL} label, and the chat records that you let it in.`,
      confirm: 'Trust this issue',
    });
    if (ok) void act(c.key, () => api.trustIssue(repo.id, c.number));
  };
  const closePr = async (c: KanbanCard) => {
    const ok = await confirmDialog({
      tone: 'danger',
      title: `Close PR #${c.number}?`,
      body: `“${c.title}” will be closed without merging, and any QA or fix work on it stops. Its issue stays open and waits for you to assign it again. The branch stays on GitHub.`,
      confirm: 'Close PR',
    });
    if (ok) void act(c.key, () => api.closePull(repo.id, c.number));
  };
  // Every PR card's one action row (#232): two buttons chosen by its state, the rest in the ⋯ (closing last).
  const actionSpec = (c: KanbanCard, a: CardAction): { label: string; icon: IconName; run: () => void; title?: string; hint?: string; good?: boolean; disabled?: boolean } => {
    const busy = pending === c.key;
    const pr = repo.pulls.find((p) => p.number === c.prNumber);
    const open = (url?: string | null) => () => void (url && window.open(url, '_blank', 'noopener,noreferrer'));
    switch (a) {
      case 'preview':
        return { label: 'Preview', icon: 'monitor', title: `Run PR #${c.number} beside ${repo.defaultBranch} and open it in the app viewer`, run: () => openOverlay({ kind: 'app', repoId: repo.id, pr: c.number }) };
      case 'terminal':
        return { label: 'Terminal', icon: 'terminal', title: c.agent && `Open ${c.agent.name}'s terminal`, run: () => c.agent && openOverlay({ kind: 'terminal', agentId: c.agent.id }) };
      case 'history':
        return { label: 'History', icon: 'scroll-text', title: `The sessions on PR #${c.number}`, run: () => openOverlay({ kind: 'manager', tab: 'history', history: { repoId: repo.id, pr: c.number } }) };
      case 'qa-report':
        return { label: 'QA report', icon: 'external-link', hint: 'On GitHub', run: open(c.qa?.commentUrl) };
      case 'send-to-qa':
        return { label: 'Send to QA', icon: 'flask-conical', good: true, disabled: busy, run: () => void act(c.key, () => api.sendToQa(repo.id, c.number)) };
      case 'retry-qa':
        return { label: 'Retry QA', icon: 'rotate-cw', good: true, disabled: busy, run: () => void act(c.key, () => api.sendToQa(repo.id, c.number)) };
      case 'send-back':
        return { label: 'Send back', icon: 'wrench', hint: "With QA's findings, no QA round first", title: "Hand it to its author, or any free agent, with QA's findings and your note, without another QA round first", disabled: busy, run: () => void sendBack(c) };
      case 'merge':
        return { label: 'Merge', icon: 'git-merge', good: true, disabled: busy || pr?.isDraft, run: () => void merge(c) };
      case 'merge-anyway':
        return { label: 'Merge anyway', icon: 'git-merge', hint: 'Without passing QA', disabled: busy, run: () => void merge(c) };
      case 'review':
        return { label: 'Review on GitHub', icon: 'external-link', run: open(c.url) };
      case 'close':
        return { label: 'Close PR…', icon: 'x', hint: 'Closed without merging; the branch stays', disabled: busy, run: () => void closePr(c) };
    }
  };
  // the label hides on a narrow card, leaving the icon with the label as its tooltip (kanbanCard.css)
  const actionButton = (c: KanbanCard, a: CardAction) => {
    const x = actionSpec(c, a);
    return (
      <button key={a} className={`btn btn-small ${x.good ? 'btn-good' : ''}`} title={x.title ?? x.label} aria-label={x.label} disabled={x.disabled} onClick={x.run}>
        <Icon name={x.icon} />
        <span className="kcard-act-label">{x.label}</span>
      </button>
    );
  };
  const actionRow = (c: KanbanCard, col: 'qa' | 'ready') => {
    const st = c.qa?.status;
    const { visible, menu } = cardActions(cardState(col, st, c.untrusted), { agent: !!c.agent, qaReport: !!c.qa?.commentUrl, untested: !st, status: st });
    return (
      <div className="kcard-actions">
        {visible.map((a) => actionButton(c, a))}
        <Menu
          label={`More for PR #${c.number}`}
          title={`PR #${c.number} ${c.title}`}
          items={menu.map((a) => {
            const x = actionSpec(c, a);
            return { label: x.label, hint: x.hint, danger: DANGER.has(a), disabled: x.disabled, onSelect: x.run };
          })}
        />
      </div>
    );
  };
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
  const column = (title: React.ReactNode, cls: string, cards: KanbanCard[], render: (c: KanbanCard) => React.ReactNode, id: EmptyKind & ColumnId) => {
    const shut = folded(id);
    const summary = shut && foldSummary(id, cards);
    return (
      <div className={`kcol ${cls} ${shut ? 'kcol-shut' : ''}`} ref={(el) => void (colEls.current[id] = el)}>
        <button type="button" className="kcol-head" aria-expanded={!shut} aria-controls={`${foldId}-${id}`} onClick={() => fold(id, !shut)}>
          <span className="kcol-name">{title}</span> <span className="count">{cards.length}</span>
          {summary && <span className="kcol-summary">{summary}</span>}
          <span className="kcol-chev" aria-hidden="true">
            <Icon name="chevron-right" />
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
      className="kanban-frame"
      wide
      accent={repo.color}
      title={
        <span className="kanban-heading">
          <span className="kanban-repo">
            <Icon name="clipboard-list" />
            <span className="kanban-repo-name" title={repo.fullName}>{repo.fullName}</span>
            <a className="kanban-github small" href={repo.url} target="_blank" rel="noreferrer" aria-label="View repository on GitHub">
              <span>GitHub</span> <Icon name="external-link" />
            </a>
          </span>
          <button
            className={`btn btn-small kanban-sync ${repo.syncError ? 'kanban-sync-error' : ''}`}
            disabled={pending === 'sync'}
            aria-label="Sync repository"
            aria-busy={pending === 'sync'}
            title={repo.syncError || 'Sync issues and pull requests from GitHub'}
            onClick={() => void act('sync', () => api.syncRepo(repo.id))}
          >
            <Icon name="refresh-cw" className={pending === 'sync' ? 'kanban-sync-spin' : undefined} />
            <span aria-live="polite">{pending === 'sync' ? 'Syncing…' : repo.syncError ? 'Sync failed' : repo.lastSync ? `Synced ${new Date(repo.lastSync).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })}` : 'Sync now'}</span>
          </button>
          {!embedded && <InfoButton screen="kanban" />}
        </span>
      }
    >
      <div className="kanban-toolbar">
        <div className="kanban-actions">
          <button className="btn btn-small btn-good" aria-expanded={showForm} onClick={() => setShowForm((v) => !v)}>
            {showForm ? 'Cancel' : '+ New issue'}
          </button>
          <button className="btn btn-small" onClick={() => openOverlay({ kind: 'app', repoId: repo.id })} title="Open this floor's running app">
            <Icon name="monitor" /> View app
          </button>
        </div>
        <div className="kanban-settings" role="group" aria-label="Floor settings">
          <label className="kanban-setting" title="Auto-assign work to free agents">
            <span className="kanban-setting-label"><Icon name="zap" /><span>Auto-assign</span></span>
            <input type="checkbox" role="switch" checked={repo.autoAssign} onChange={(e) => void api.updateRepo(repo.id, { autoAssign: e.target.checked }).catch(() => undefined)} />
          </label>
          <label className="kanban-setting" title="Merge a PR as soon as QA has signed off on its latest commit and GitHub's checks are green">
            <span className="kanban-setting-label"><Icon name="git-merge" /><span>Auto-merge</span></span>
            <input type="checkbox" role="switch" checked={repo.autoMerge} onChange={(e) => void api.updateRepo(repo.id, { autoMerge: e.target.checked }).catch(() => undefined)} />
          </label>
        </div>
      </div>
      {repo.syncError && (
        <div className="term-error">
          <Icon name="triangle-alert" /> {repo.syncError}
        </div>
      )}
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
          <>
            <Icon name="clipboard-list" /> Backlog
          </>,
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
              <span className="spacer" />
              <AssignButton repoId={repo.id} number={c.number} title={c.title} small />
            </div>
          ),
          'backlog',
        )}
        {column(
          <>
            <Icon name="hammer" /> In progress
          </>,
          'kcol-progress',
          cols.progress,
          (c) => (
            <>
              <div className="kcard-who">
                <AgentChip agent={c.agent} card={c} note={c.note} />
              </div>
              {c.agent && <div className="kcard-actions">{actionButton(c, 'terminal')}</div>}
            </>
          ),
          'progress',
        )}
        {column(
          <>
            <Icon name="search" /> In QA
          </>,
          'kcol-qa',
          cols.qa,
          (c) => {
            const wait = c.qa && !c.untrusted ? prWaitLine(c.qa, repo.defaultBranch, now) : null;
            return (
              <>
                <div className="kcard-who">
                  <AgentChip agent={c.untrusted ? undefined : c.agent} card={c} note={c.note} />
                </div>
                {wait && <div className="small kcard-wait">{wait}</div>}
                {actionRow(c, 'qa')}
              </>
            );
          },
          'qa',
        )}
        {column(
          <>
            <Icon name="circle-check" /> Ready to merge
          </>,
          'kcol-review',
          cols.ready,
          (c) => {
            const pr = repo.pulls.find((p) => p.number === c.prNumber);
            return (
              <>
                <div className="kcard-who">
                  <AgentChip agent={c.agent} card={c} note={`${c.note ?? ''}${pr ? ` · +${pr.additions} −${pr.deletions}` : ''}`} />
                </div>
                {actionRow(c, 'ready')}
              </>
            );
          },
          'ready',
        )}
        {column(
          <>
            <Icon name="party-popper" /> Merged
          </>,
          'kcol-merged',
          cols.merged,
          (c) => (
            <div className="kcard-who">
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
