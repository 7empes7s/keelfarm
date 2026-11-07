import { useMemo } from 'react';
import { blockers } from '../../../shared/issues';
import { agentsOnRepo, kanbanFor, useStore, type Agent, type KanbanCard } from '../store';
import { elapsedLabel } from '../qaCard';
import { bodyExcerpt, cardLabel, canPeel, locateCard } from '../world/whiteboard';
import type { Col } from '../world/stickies';
import type { PullInfo, RepoView } from '../../../shared/types';
import { Actions, AgentChip, ChecksList, ChecksStat, Chip, DetailsHeader, LinkButton, Section, Stat, StatStrip, StatusRows, Verdict } from './DetailsPage';
import { mergeRows, stateChip } from './detailsRules';
import { Key } from './Key';
import { Markdown } from './Markdown';
import { Panel } from './Panel';

// One whiteboard card up close (E on a sticky, or a card tapped on the Kanban): a header card with the title, its state,
// who has it and when; for a PR an insight strip, QA's verdict, its checks as cards, and CI and merge as status rows;
// the issue's first lines; then the actions as buttons (#155). It reads the office's state as it stands (and follows
// the card as it moves); nothing here asks the server for more.

const COLUMN: Record<Col, string> = { backlog: '📋 Backlog', progress: '🔨 In progress', qa: '🔍 In QA', ready: '✅ Ready to merge', merged: '🎉 Merged' };

const clock = (t: number) => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const age = (iso: string | null | undefined) => {
  const t = iso ? Date.parse(iso) : NaN;
  return Number.isFinite(t) ? elapsedLabel(Date.now() - t) : null;
};
const CI: Record<PullInfo['checks'], string> = { passing: 'Passing', failing: 'Failing', pending: 'Running', none: 'None' };

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
  const { card, col } = at;
  const pull = card.prNumber ? repo.pulls.find((p) => p.number === card.prNumber) : undefined;
  const issueNumber = pull ? pull.closesIssues[0] : card.number;
  const issue = issueNumber ? repo.issues.find((i) => i.number === issueNumber) : undefined;
  const open = new Set(repo.issues.map((i) => i.number));
  const waits = issue ? blockers(issue.body, open) : [];
  const waiters = issue ? repo.issues.filter((i) => blockers(i.body, open).includes(issue.number)).map((i) => i.number) : [];
  const excerpt = issue ? bodyExcerpt(issue.body) : null;
  const url = card.url ?? pull?.url ?? issue?.url;
  const q = card.qa;
  const chip = stateChip(q, pull, !card.prNumber);
  const builder = (q?.devAgentId ? allAgents[q.devAgentId] : undefined) ?? (q?.status === 'testing' ? undefined : card.agent);
  const tester = q?.qaAgentId ? allAgents[q.qaAgentId] : undefined;
  const onIt = (q?.status === 'testing' ? tester : undefined) ?? card.agent ?? builder;
  const id = (part: string) => `cv-${repo.id}-${card.key}-${part}`;

  return (
    <Panel className="cardview" accent={repo.color} title={`📌 ${cardLabel(card)}`}>
      <DetailsHeader
        eyebrow={`${cardLabel(card)} · floor ${repo.floor} · ${repo.fullName.split('/')[1]}`}
        title={card.title}
        chips={
          <>
            <Chip tone={chip.tone}>{chip.label}</Chip>
            {q && <Chip>Round {q.round}</Chip>}
            <Chip>{COLUMN[col]}</Chip>
            {card.note && !card.note.toLowerCase().includes(chip.label.toLowerCase()) && <Chip tone={card.tone}>{card.note}</Chip>}
            {waits.length > 0 && <Chip tone="warn">⏳ waits for #{waits.join(', #')}</Chip>}
            {waiters.length > 0 && <Chip>🔗 #{waiters.join(', #')} wait{waiters.length === 1 ? 's' : ''} for this</Chip>}
            {issue?.labels.map((l) => <Chip key={l}>{l}</Chip>)}
          </>
        }
      >
        <People card={card} col={col} builder={builder} tester={tester} />
        <WhenLine col={col} filed={issue?.createdAt} pull={pull} updatedAt={q?.updatedAt ?? card.agent?.startedAt} />
      </DetailsHeader>

      {card.prNumber && <PrDetails repo={repo} card={card} pull={pull} id={id} />}

      {(excerpt?.text || !pull) && (
        <Section title={pull && issue ? `Closes #${issue.number}: ${issue.title}` : 'The issue'}>
          {excerpt?.text ? (
            <div className="dp-body">
              <Markdown text={excerpt.text} />
              {excerpt.more && <div className="muted small">…</div>}
            </div>
          ) : (
            <p className="muted small">The issue has no description.</p>
          )}
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
        {url && <LinkButton href={url}>Open on GitHub ↗</LinkButton>}
        {q?.commentUrl && <LinkButton href={q.commentUrl}>QA report ↗</LinkButton>}
        {onIt && (
          <button type="button" className="ds-btn" onClick={() => useStore.getState().openOverlay({ kind: 'terminal', agentId: onIt.id })}>
            Terminal
          </button>
        )}
        {pull?.state === 'OPEN' && (
          <button type="button" className="ds-btn" onClick={() => useStore.getState().openOverlay({ kind: 'app', repoId: repo.id, pr: pull.number })}>
            Preview
          </button>
        )}
      </Actions>
    </Panel>
  );
}

/** Who built it and who's testing it, as chips that open their windows. */
function People({ card, col, builder, tester }: { card: KanbanCard; col: Col; builder?: Agent; tester?: Agent }) {
  const testing = card.qa?.status === 'testing';
  if (!builder && !tester) return <div className="dp-meta">{col === 'backlog' ? 'Nobody has it yet' : card.prNumber ? 'Opened outside the office' : 'Someone has it'}</div>;
  return (
    <div className="dp-people">
      {builder && <AgentChip agent={builder} role={col === 'progress' ? 'Building' : card.qa?.status === 'fixing' ? 'Fixing' : 'Built by'} />}
      {tester && card.prNumber && <AgentChip agent={tester} role={testing ? 'Testing' : 'Tested by'} />}
    </div>
  );
}

function WhenLine({ col, filed, pull, updatedAt }: { col: Col; filed?: string; pull?: PullInfo; updatedAt?: number | null }) {
  const parts = [
    col === 'merged' && pull?.mergedAt ? `Merged ${age(pull.mergedAt)} ago` : null,
    col === 'backlog' && filed ? `Filed ${age(filed)} ago` : null,
    updatedAt && Number.isFinite(updatedAt) && col !== 'merged' ? `Updated ${clock(updatedAt)} (${elapsedLabel(Date.now() - updatedAt)} ago)` : null,
  ].filter(Boolean);
  return parts.length ? <div className="dp-meta">{parts.join(' · ')}</div> : null;
}

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
        <Stat title="QA round" value={q ? q.round : '–'} note={q ? 'rounds so far' : 'not sent yet'} to={id('qa')} />
        <Stat title="Opened" value={opened ?? '–'} note="ago" />
        {pull && <Stat title="Lines" value={`+${pull.additions} −${pull.deletions}`} note="changed" />}
        {pull && <Stat title="CI" value={CI[pull.checks]} note={blocked ? 'merge blocked' : 'merge clear'} tone={blocked ? 'warn' : pull.checks === 'passing' ? 'good' : undefined} to={id('ci')} />}
      </StatStrip>

      <Section id={id('qa')} title={`🔍 QA${q ? ` · round ${q.round}` : ''}`} tone={failed ? 'bad' : undefined}>
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
        <Section id={id('ci')} title="⚙️ CI and merge">
          <StatusRows rows={rows} />
        </Section>
      )}
    </>
  );
}
