import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { blockers } from '../../../shared/issues';
import { objectiveTag } from '../../../shared/charter';
import type { HistoryEntry } from '../../../shared/history';
import type { PullInfo, RepoView } from '../../../shared/types';
import { api } from '../api';
import { agentsOnRepo, kanbanFor, useStore, type Agent, type KanbanCard } from '../store';
import { elapsedLabel } from '../qaCard';
import { cardLabel, canPeel, locateCard } from '../world/whiteboard';
import type { Col } from '../world/stickies';
import { copyText } from './clipboard';
import { go } from './goTo';
import { acceptanceProgress, issueCost, issueTimeline, splitSections, stageAt, STAGES, STATUS } from './issueCard';
import { Key } from './Key';
import { Markdown } from './Markdown';
import { Panel } from './Panel';
import { ProgressBar } from './ProgressBar';
import './cardView.css';

// One issue or PR card up close (#206), the same from a chat ref, the Kanban and a 3D sticky (E): the whole title and
// body (its "## " sections as cards), who has it, what it waits for, its PR with QA and CI, its preview, how far along
// it is, its history and what it cost. The office's state as it stands (it follows the card as it moves), plus the
// session history for this work, read when it opens and again when a session ends.

const QA_ICON = { pass: '✓', fail: '✗', skip: '–' } as const;

const clock = (t: number) => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const day = (t: number) => new Date(t).toLocaleDateString([], { month: 'short', day: 'numeric' });
const ago = (iso: string | null | undefined) => {
  const t = iso ? Date.parse(iso) : NaN;
  return Number.isFinite(t) ? `${elapsedLabel(Date.now() - t)} ago` : '';
};
const money = (usd: number) => `$${usd.toFixed(2)}`;
const isPhone = () => typeof window !== 'undefined' && !!window.matchMedia?.('(max-width: 600px)').matches;

export function CardView({ repoId, cardKey, number, pr }: { repoId: string; cardKey: string; number: number; pr: boolean }) {
  const repo = useStore((s) => s.repos.find((r) => r.id === repoId));
  const allAgents = useStore((s) => s.agents);
  const qaRecords = useStore((s) => s.qa);
  const agents = useMemo(() => agentsOnRepo(allAgents, repoId), [allAgents, repoId]);
  const cols = useMemo(() => (repo ? kanbanFor(repo, agents, qaRecords) : null), [repo, agents, qaRecords]);
  const at = cols ? locateCard(cols, cardKey, number, pr) : null;

  if (!repo || !at) {
    return (
      <Panel title={`📌 ${cardLabel({ number, pr })}`} className="cardview">
        <p className="muted">That card isn't on the board any more.</p>
      </Panel>
    );
  }
  return <Card repo={repo} card={at.card} col={at.col} ceo={Object.values(allAgents).find((a) => a.role === 'ceo')} />;
}

/** The sessions on this work (its issue and its PR) and the floor's latest, for the history and the cost. */
function useWorkHistory(repoId: string, issue: number | undefined, pr: number | undefined) {
  const seq = useStore((s) => s.historySeq);
  const [got, setGot] = useState<{ mine: HistoryEntry[]; floor: HistoryEntry[] }>({ mine: [], floor: [] });
  useEffect(() => {
    let live = true;
    const none = Promise.resolve({ entries: [] as HistoryEntry[] });
    void Promise.all([
      issue ? api.history({ repoId, issue, limit: 100 }, false) : none,
      pr ? api.history({ repoId, pr, limit: 100 }, false) : none,
      api.history({ repoId, limit: 100 }, false),
    ]).then(
      ([a, b, floor]) => live && setGot({ mine: [...new Map([...a.entries, ...b.entries].map((e) => [e.id, e])).values()], floor: floor.entries }),
      () => {},
    );
    return () => void (live = false);
  }, [repoId, issue, pr, seq]);
  return got;
}

function Card({ repo, card, col, ceo }: { repo: RepoView; card: KanbanCard; col: Col; ceo?: Agent }) {
  const pull = card.prNumber ? repo.pulls.find((p) => p.number === card.prNumber) : undefined;
  const issueNumber = pull ? pull.closesIssues[0] : card.number;
  const issue = issueNumber ? repo.issues.find((i) => i.number === issueNumber) : undefined;
  const open = new Set(repo.issues.map((i) => i.number));
  const waits = issue ? blockers(issue.body, open) : [];
  const waiters = issue ? repo.issues.filter((i) => blockers(i.body, open).includes(issue.number)).map((i) => i.number) : [];
  const url = card.url ?? pull?.url ?? issue?.url;
  const [phone] = useState(isPhone);
  const [readAll, setReadAll] = useState(false);
  const body = useMemo(() => splitSections(issue?.body ?? '', phone), [issue?.body, phone]);
  const { mine, floor } = useWorkHistory(repo.id, issueNumber, card.prNumber);
  const issueOf = (pr: number) => repo.pulls.find((p) => p.number === pr)?.closesIssues[0];
  const work = (e: HistoryEntry) => (e.issue !== null ? `i${e.issue}` : e.pr !== null ? (issueOf(e.pr) ? `i${issueOf(e.pr)}` : `p${e.pr}`) : null);
  const cost = issueCost(mine, floor, work, issueNumber ? `i${issueNumber}` : `p${card.prNumber}`);
  const building = col === 'progress' && card.agent?.startedAt ? { agent: card.agent.name, at: card.agent.startedAt } : null;
  const timeline = issueTimeline({ issue, pull, entries: mine, live: building });
  const acceptance = body.sections.find((s) => /^acceptance\b/i.test(s.title));
  const reports = [card.qa?.summary ?? '', ...(card.qa?.checks ?? []).filter((c) => c.result === 'pass').map((c) => `- [x] ${c.name}`)];
  const ticked = acceptance ? acceptanceProgress(acceptance.text, reports) : null;
  const stage = stageAt(col, !!card.qa);
  const objective = issue ? objectiveTag(issue.body) : null;
  const title = pull && issue ? issue.title : card.title;
  const ask = `About ${cardLabel(card)} on floor ${repo.floor} (${card.title}): `;

  const copy = () =>
    void copyText(url ?? '').then((ok) => useStore.getState().pushToast(ok ? 'success' : 'error', ok ? 'Link copied' : "Couldn't copy the link"));

  return (
    <Panel className="cardview" accent={repo.color} title={<span className="cardview-title">{title || cardLabel(card)}</span>}>
      <div className="cardview-tags">
        <span className="pill">Floor {repo.floor}</span>
        <span className="pill">{cardLabel(card)}</span>
        {objective && <span className="pill cardview-label">{objective}</span>}
        <span className={`pill cardview-status cardview-status-${col}`}>{STATUS[col]}</span>
        {card.note && <span className={`pill ${card.tone ? `cardview-${card.tone}` : ''}`}>{card.note}</span>}
        {issue?.labels.map((l) => (
          <span key={l} className="pill cardview-label">
            {l}
          </span>
        ))}
      </div>
      {pull && issue && card.title !== issue.title && <div className="muted small">PR: {card.title}</div>}

      <div className="cardview-strip">
        <Who card={card} col={col} filed={issue?.createdAt} opened={pull?.createdAt} mergedAt={pull?.mergedAt} />
        {waits.map((n) => (
          <Stat key={`w${n}`} icon="⏳" title="Waits for" tone="warn" onTap={() => go({ kind: 'overlay', overlay: { kind: 'card', repoId: repo.id, key: `i-${n}`, number: n, pr: false } })}>
            #{n} {repo.issues.find((i) => i.number === n)?.title}
          </Stat>
        ))}
        {waiters.map((n) => (
          <Stat key={`h${n}`} icon="🔗" title="Holds up" onTap={() => go({ kind: 'overlay', overlay: { kind: 'card', repoId: repo.id, key: `i-${n}`, number: n, pr: false } })}>
            #{n} {repo.issues.find((i) => i.number === n)?.title}
          </Stat>
        ))}
        {pull && (
          <Stat icon="🔀" title={`PR #${pull.number}`} tone={pull.checks === 'failing' || card.qa?.status === 'failed' ? 'bad' : undefined} href={card.qa?.commentUrl ?? pull.url}>
            {checksWord(pull)}
            {card.qa ? ` · QA round ${card.qa.round}: ${card.qa.status}` : ' · not in QA yet'}
          </Stat>
        )}
        {pull?.state === 'OPEN' && !pull.untrusted && (
          <Stat icon="▶" title="Preview" onTap={() => go({ kind: 'overlay', overlay: { kind: 'app', repoId: repo.id, pr: pull.number } })}>
            Run PR #{pull.number} beside {repo.defaultBranch}
          </Stat>
        )}
      </div>

      {ticked ? (
        <ProgressBar label="Acceptance" value={`${ticked.done} of ${ticked.total}`} pct={ticked.done / ticked.total} tone={ticked.done === ticked.total ? 'good' : 'neutral'} aria={`Acceptance: ${ticked.done} of ${ticked.total} done`} />
      ) : (
        <ProgressBar label="Progress" value={STAGES[stage] ?? 'Merged'} steps={{ labels: STAGES, at: stage }} tone={stage >= STAGES.length ? 'good' : 'neutral'} aria={`Stage: ${STAGES[stage] ?? 'merged'}`} />
      )}

      {issue ? (
        <div className="cardview-body">
          {body.intro && <Markdown text={body.intro} />}
          {body.sections.length > 1 && (
            <button type="button" className="btn btn-small btn-ghost cardview-readall" onClick={() => setReadAll(true)} disabled={readAll}>
              Read all
            </button>
          )}
          {body.sections.map((s, i) => (
            <details key={`${i}-${readAll}`} className="cardview-sec" open={readAll || s.open}>
              <summary>{s.title}</summary>
              {s.text ? <Markdown text={s.text} /> : <p className="muted small">Empty.</p>}
            </details>
          ))}
          {!body.intro && !body.sections.length && <p className="muted small">The issue has no description.</p>}
        </div>
      ) : (
        !pull && <p className="muted small">The issue has no description.</p>
      )}

      {card.prNumber && <PrDetails card={card} pull={pull} />}

      {timeline.length > 0 && (
        <section className="cardview-section">
          <h4 className="cardview-h">History</h4>
          <ol className="cardview-timeline">
            {timeline.map((e, i) => (
              <li key={i} className={e.tone ? `cardview-tl-${e.tone}` : undefined}>
                <span aria-hidden>{e.icon}</span>
                <span className="grow">{e.text}</span>
                <time className="muted small" dateTime={new Date(e.at).toISOString()}>
                  {day(e.at)} {clock(e.at)}
                </time>
              </li>
            ))}
          </ol>
        </section>
      )}

      {cost.sessions > 0 && (
        <section className="cardview-section">
          <h4 className="cardview-h">Cost so far</h4>
          <div className="small">
            {cost.sessions} session{cost.sessions === 1 ? '' : 's'} · {elapsedLabel(cost.ms)} · <b>{money(cost.usd)}</b>
            {cost.median !== null && <span className="muted"> · floor median {money(cost.median)}</span>}
          </div>
        </section>
      )}

      <div className="cardview-foot">
        {url && (
          <a className="btn" href={url} target="_blank" rel="noreferrer">
            Open on GitHub ↗
          </a>
        )}
        <button type="button" className="btn" onClick={() => go({ kind: 'ceo', text: ask })}>
          Ask {ceo?.name ?? 'the CEO'} about this
        </button>
        {url && (
          <button type="button" className="btn" onClick={copy}>
            Copy link
          </button>
        )}
        <span className="muted small cardview-keys">
          {canPeel(col, card) && (
            <>
              <Key action="drop" /> on the sticky takes it to a free agent's desk ·{' '}
            </>
          )}
          <kbd>Esc</kbd> closes
        </span>
      </div>
    </Panel>
  );
}

const checksWord = (p: Pick<PullInfo, 'checks' | 'mergeable'>) =>
  `${p.checks === 'passing' ? '✓ checks pass' : p.checks === 'failing' ? '✗ checks failing' : p.checks === 'pending' ? '… checks running' : 'no checks'}${p.mergeable === 'CONFLICTING' ? ' · conflicts' : ''}`;

/** One card of the status strip: a 44 px button or link to what it's about. */
function Stat({ icon, title, tone, onTap, href, label, children }: { icon: ReactNode; title: string; tone?: 'warn' | 'bad'; onTap?: () => void; href?: string; label?: string; children: ReactNode }) {
  const inner = (
    <>
      <span className="cardview-stat-icon" aria-hidden>
        {icon}
      </span>
      <span className="cardview-stat-text">
        <b>{title}</b>
        {children && <span>{children}</span>}
      </span>
    </>
  );
  const cls = `cardview-stat${tone ? ` cardview-stat-${tone}` : ''}`;
  if (href)
    return (
      <a className={cls} href={href} target="_blank" rel="noreferrer">
        {inner}
      </a>
    );
  if (onTap)
    return (
      <button type="button" className={cls} onClick={onTap} aria-label={label}>
        {inner}
      </button>
    );
  return <div className={cls}>{inner}</div>;
}

/** Who has it now, for how long and doing what; tapping opens their terminal. */
function Who({ card, col, filed, opened, mergedAt }: { card: KanbanCard; col: Col; filed?: string; opened?: string; mergedAt?: string | null }) {
  const a = card.agent;
  const doing = a?.activity ? (a.activity.detail ? `${a.activity.kind}: ${a.activity.detail}` : a.activity.kind) : '';
  const dur = (t: number | null | undefined) => (t && Number.isFinite(t) ? elapsedLabel(Date.now() - t) : '');
  const line = (...parts: string[]) => parts.filter(Boolean).join(' · ');
  const [title, sub] =
    col === 'backlog'
      ? ['Nobody has it yet', filed ? `Filed ${ago(filed)}` : '']
      : col === 'progress'
        ? [a ? `@${a.name} building` : 'Someone has it', line(dur(a?.startedAt), doing)]
        : col === 'merged'
          ? ['Merged', line(ago(mergedAt), a ? `written by @${a.name}` : '')]
          : card.qa?.status === 'testing'
            ? [`@${a?.name ?? 'QA'} testing`, line(`Round ${card.qa.round}`, dur(card.qa.updatedAt), doing)]
            : card.qa?.status === 'fixing'
              ? [`@${a?.name ?? 'An agent'} fixing`, line(dur(card.qa.updatedAt), doing)]
              : [a ? `@${a.name} wrote it` : 'Opened outside the office', opened ? `Opened ${ago(opened)}` : ''];
  const avatar = a ? (
    <span className="cardview-avatar" style={{ background: a.color }}>
      {a.name[0]}
    </span>
  ) : (
    '👤'
  );
  return (
    <Stat icon={avatar} title={title} onTap={a ? () => go({ kind: 'overlay', overlay: { kind: 'terminal', agentId: a.id } }) : undefined} label={a ? `${line(title, sub)}: open their terminal` : undefined}>
      {sub}
    </Stat>
  );
}

function PrDetails({ card, pull }: { card: KanbanCard; pull?: Pick<PullInfo, 'checks' | 'failedChecks' | 'pendingChecks' | 'mergeable' | 'isDraft'> }) {
  const q = card.qa;
  return (
    <div className="cardview-pr">
      <div className="cardview-section">
        <h4 className="cardview-h">🔍 QA{q ? ` · round ${q.round}` : ''}</h4>
        {!q && <p className="muted small">Not sent to QA yet.</p>}
        {q?.summary && <Markdown text={q.summary} className="cardview-summary" />}
        {q && !q.summary && <p className="muted small">No report yet{q.status === 'testing' ? ': the test is running' : ''}.</p>}
        {q && q.checks.length > 0 && (
          <ul className="cardview-checks">
            {q.checks.map((c, i) => (
              <li key={i} className={`cardview-check cardview-check-${c.result}`}>
                <b>{QA_ICON[c.result]}</b> {c.name}
                {c.details && <span className="muted"> · {c.details}</span>}
              </li>
            ))}
          </ul>
        )}
        {q?.commentUrl && (
          <a href={q.commentUrl} target="_blank" rel="noreferrer" className="small">
            Open the QA report ↗
          </a>
        )}
      </div>
      {pull && (
        <div className="cardview-section">
          <h4 className="cardview-h">⚙️ CI</h4>
          <div className="small">
            {pull.checks === 'passing' ? '✓ All checks pass' : pull.checks === 'failing' ? '✗ Checks failing' : pull.checks === 'pending' ? '… Checks running' : 'No checks'}
            {pull.mergeable === 'CONFLICTING' && <span className="cardview-bad-text"> · conflicts with the base branch</span>}
            {pull.isDraft && <span className="muted"> · draft</span>}
          </div>
          {pull.failedChecks.length > 0 && (
            <ul className="cardview-checks">
              {pull.failedChecks.map((c) => (
                <li key={c.name} className="cardview-check cardview-check-fail">
                  <b>✗</b>{' '}
                  {c.url ? (
                    <a href={c.url} target="_blank" rel="noreferrer">
                      {c.name}
                    </a>
                  ) : (
                    c.name
                  )}
                </li>
              ))}
            </ul>
          )}
          {pull.pendingChecks.length > 0 && <div className="muted small">Running: {pull.pendingChecks.join(', ')}</div>}
        </div>
      )}
    </div>
  );
}
