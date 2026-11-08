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
import { Icon } from './Icon';
import { copyText } from './clipboard';
import { Actions, AgentChip, ChecksList, ChecksStat, Chip, DetailsHeader, LinkButton, Section, Stat as Tile, StatStrip, StatusRows, Verdict } from './DetailsPage';
import { mergeRows, stateChip, type ChipTone } from './detailsRules';
import { go } from './goTo';
import { acceptanceProgress, issueCost, issueTimeline, splitSections, stageAt, STAGES, STATUS } from './issueCard';
import { Key } from './Key';
import { AssignButton } from './AssignSheet';
import { Markdown } from './Markdown';
import { Panel } from './Panel';
import { ProgressBar } from './ProgressBar';
import './cardView.css';

// One issue or PR card up close (#206), the same from a chat ref, the Kanban and a 3D sticky (E): a header card with the
// whole title, its state and who built and tests it (#155), the body (its "## " sections as cards), what it waits for,
// its PR with QA's verdict, checks as cards and CI and merge as status rows, its preview, how far along it is, its
// history and what it cost, then the actions as buttons. The office's state as it stands (it follows the card as it
// moves), plus the session history for this work, read when it opens and again when a session ends.

const STATUS_TONE: Record<Col, ChipTone> = { backlog: 'plain', progress: 'warn', qa: 'warn', ready: 'good', merged: 'good' };
const CI: Record<PullInfo['checks'], string> = { passing: 'Passing', failing: 'Failing', pending: 'Running', none: 'None' };

const clock = (t: number) => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const day = (t: number) => new Date(t).toLocaleDateString([], { month: 'short', day: 'numeric' });
const ago = (iso: string | null | undefined) => {
  const t = iso ? Date.parse(iso) : NaN;
  return Number.isFinite(t) ? `${elapsedLabel(Date.now() - t)} ago` : '';
};
const age = (iso: string | null | undefined) => {
  const t = iso ? Date.parse(iso) : NaN;
  return Number.isFinite(t) ? elapsedLabel(Date.now() - t) : null;
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
      <Panel
        title={
          <span>
            <Icon name="pin" /> {cardLabel({ number, pr })}
          </span>
        }
        className="cardview"
      >
        <p className="muted">That card isn't on the board any more.</p>
      </Panel>
    );
  }
  return <Card repo={repo} card={at.card} col={at.col} allAgents={allAgents} ceo={Object.values(allAgents).find((a) => a.role === 'ceo')} />;
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

function Card({ repo, card, col, allAgents, ceo }: { repo: RepoView; card: KanbanCard; col: Col; allAgents: Record<string, Agent>; ceo?: Agent }) {
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
  const q = card.qa;
  const chip = stateChip(q, pull, !card.prNumber);
  const builder = (q?.devAgentId ? allAgents[q.devAgentId] : undefined) ?? (q?.status === 'testing' ? undefined : card.agent);
  const tester = q?.qaAgentId ? allAgents[q.qaAgentId] : undefined;
  const id = (part: string) => `cv-${repo.id}-${card.key}-${part}`;

  const copy = () =>
    void copyText(url ?? '').then((ok) => useStore.getState().pushToast(ok ? 'success' : 'error', ok ? 'Link copied' : "Couldn't copy the link"));

  return (
    <Panel className="cardview" accent={repo.color} title={
        <>
          <Icon name="pin" /> {cardLabel(card)}
        </>
      }
    >
      <DetailsHeader
        eyebrow={`${cardLabel(card)} · floor ${repo.floor} · ${repo.fullName.split('/')[1]}`}
        title={title || cardLabel(card)}
        chips={
          <>
            <Chip tone={chip.tone}>{chip.label}</Chip>
            {q && <Chip>Round {q.round}</Chip>}
            <Chip tone={STATUS_TONE[col]}>{STATUS[col]}</Chip>
            {objective && <Chip>{objective}</Chip>}
            {card.note && !card.note.toLowerCase().includes(chip.label.toLowerCase()) && <Chip tone={card.tone}>{card.note}</Chip>}
            {issue?.labels.map((l) => <Chip key={l}>{l}</Chip>)}
          </>
        }
      >
        {pull && issue && card.title !== issue.title && <div className="dp-meta">PR: {card.title}</div>}
        <People card={card} col={col} builder={builder} tester={tester} />
      </DetailsHeader>

      <div className="cardview-strip">
        <Who card={card} col={col} filed={issue?.createdAt} opened={pull?.createdAt} mergedAt={pull?.mergedAt} />
        {waits.map((n) => (
          <Stat key={`w${n}`} icon={<Icon name="hourglass" />} title="Waits for" tone="warn" onTap={() => go({ kind: 'overlay', overlay: { kind: 'card', repoId: repo.id, key: `i-${n}`, number: n, pr: false } })}>
            #{n} {repo.issues.find((i) => i.number === n)?.title}
          </Stat>
        ))}
        {waiters.map((n) => (
          <Stat key={`h${n}`} icon={<Icon name="link" />} title="Holds up" onTap={() => go({ kind: 'overlay', overlay: { kind: 'card', repoId: repo.id, key: `i-${n}`, number: n, pr: false } })}>
            #{n} {repo.issues.find((i) => i.number === n)?.title}
          </Stat>
        ))}
        {pull && (
          <Stat icon={<Icon name="git-merge" />} title={`PR #${pull.number}`} tone={pull.checks === 'failing' || card.qa?.status === 'failed' ? 'bad' : undefined} href={card.qa?.commentUrl ?? pull.url}>
            {checksWord(pull)}
            {card.qa ? ` · QA round ${card.qa.round}: ${card.qa.status}` : ' · not in QA yet'}
          </Stat>
        )}
        {pull?.state === 'OPEN' && !pull.untrusted && (
          <Stat icon={<Icon name="play" />} title="Preview" onTap={() => go({ kind: 'overlay', overlay: { kind: 'app', repoId: repo.id, pr: pull.number } })}>
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
        <Section title={pull ? `Closes #${issue.number}` : 'The issue'} className="cardview-body">
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
        </Section>
      ) : (
        !pull && <p className="muted small">The issue has no description.</p>
      )}

      {card.prNumber && <PrDetails repo={repo} card={card} pull={pull} id={id} />}

      {timeline.length > 0 && (
        <Section title="History">
          <ol className="cardview-timeline">
            {timeline.map((e, i) => (
              <li key={i} className={e.tone ? `cardview-tl-${e.tone}` : undefined}>
                <Icon name={e.icon} />
                <span className="grow">{e.text}</span>
                <time className="muted small" dateTime={new Date(e.at).toISOString()}>
                  {day(e.at)} {clock(e.at)}
                </time>
              </li>
            ))}
          </ol>
        </Section>
      )}

      {cost.sessions > 0 && (
        <Section title="Cost so far">
          <div className="small">
            {cost.sessions} session{cost.sessions === 1 ? '' : 's'} · {elapsedLabel(cost.ms)} · <b>{money(cost.usd)}</b>
            {cost.median !== null && <span className="muted"> · floor median {money(cost.median)}</span>}
          </div>
        </Section>
      )}

      <Actions
        keys={
          <>
            {canPeel(col, card) && (
              <>
                <Key action="drop" /> on the sticky takes it to a free agent's desk ·{' '}
              </>
            )}
            <kbd>Esc</kbd> closes
          </>
        }
      >
        {issue && !pull && col === 'backlog' && !card.untrusted && <AssignButton repoId={repo.id} number={issue.number} title={issue.title} />}
        {url && <LinkButton href={url}>Open on GitHub <Icon name="external-link" /></LinkButton>}
        {q?.commentUrl && <LinkButton href={q.commentUrl}>QA report <Icon name="external-link" /></LinkButton>}
        <button type="button" className="ds-btn" onClick={() => go({ kind: 'ceo', text: ask })}>
          Ask {ceo?.name ?? 'the CEO'} about this
        </button>
        {url && (
          <button type="button" className="ds-btn" onClick={copy}>
            Copy link
          </button>
        )}
      </Actions>
    </Panel>
  );
}

const checksWord = (p: Pick<PullInfo, 'checks' | 'mergeable'>) =>
  `${p.checks === 'passing' ? 'checks pass' : p.checks === 'failing' ? 'checks failing' : p.checks === 'pending' ? 'checks running' : 'no checks'}${p.mergeable === 'CONFLICTING' ? ' · conflicts' : ''}`;

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
    <Icon name="user" />
  );
  return (
    <Stat icon={avatar} title={title} onTap={a ? () => go({ kind: 'overlay', overlay: { kind: 'terminal', agentId: a.id } }) : undefined} label={a ? `${line(title, sub)}: open their terminal` : undefined}>
      {sub}
    </Stat>
  );
}

/** Who built it and who's testing it, as chips that open their windows. */
function People({ card, col, builder, tester }: { card: KanbanCard; col: Col; builder?: Agent; tester?: Agent }) {
  if (!builder && !(tester && card.prNumber)) return null;
  return (
    <div className="dp-people">
      {builder && <AgentChip agent={builder} role={col === 'progress' ? 'Building' : card.qa?.status === 'fixing' ? 'Fixing' : 'Built by'} />}
      {tester && card.prNumber && <AgentChip agent={tester} role={card.qa?.status === 'testing' ? 'Testing' : 'Tested by'} />}
    </div>
  );
}

/** The PR's insight strip, QA's verdict, its checks as cards, and CI and merge as status rows (#155). */
function PrDetails({ repo, card, pull, id }: { repo: RepoView; card: KanbanCard; pull?: PullInfo; id: (part: string) => string }) {
  const q = card.qa;
  const failed = q?.status === 'failed' || q?.status === 'fixing' || q?.status === 'needs-human';
  const rows = pull ? mergeRows(pull, repo.defaultBranch) : [];
  const blocked = rows.some((r) => r.tone === 'bad');
  const opened = age(pull?.createdAt);
  return (
    <>
      <StatStrip>
        <ChecksStat checks={q?.checks ?? []} to={id('checks')} />
        <Tile title="QA round" value={q ? q.round : '–'} note={q ? 'rounds so far' : 'not sent yet'} to={id('qa')} />
        <Tile title="Opened" value={opened ?? '–'} note="ago" />
        {pull && <Tile title="Lines" value={`+${pull.additions} −${pull.deletions}`} note="changed" />}
        {pull && <Tile title="CI" value={CI[pull.checks]} note={blocked ? 'merge blocked' : 'merge clear'} tone={blocked ? 'warn' : pull.checks === 'passing' ? 'good' : undefined} to={id('ci')} />}
      </StatStrip>

      <Section
        id={id('qa')}
        title={
          <>
            <Icon name="search" /> QA{q ? ` · round ${q.round}` : ''}
          </>
        }
        tone={failed ? 'bad' : undefined}
      >
        {!q && <p className="muted small">Not sent to QA yet.</p>}
        {q && !q.summary && <p className="muted small">No report yet{q.status === 'testing' ? ': the test is running' : ''}.</p>}
        {q && <Verdict summary={q.summary} fix={q.fixInstructions} failed={failed} />}
      </Section>

      {q && q.checks.length > 0 && (
        <Section id={id('checks')} title="Checks">
          <ChecksList checks={q.checks} />
        </Section>
      )}

      {pull && (
        <Section id={id('ci')} title={
            <>
              <Icon name="settings" /> CI and merge
            </>
          }
        >
          <StatusRows rows={rows} />
        </Section>
      )}
    </>
  );
}
