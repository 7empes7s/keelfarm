// The hover cards' bodies (#213): an agent, an issue or PR, a QA verdict and its checks. Read from the store as it is.
import { firstRoundRate, mergesThisWeek, rank, weeklySeries } from '../../../shared/careers';
import type { QaView, RepoView } from '../../../shared/types';
import { qaKey, useStore, type Agent } from '../store';
import { fmtUsd } from '../ops';
import { agentPhrase } from './statusPhrase';
import { PeekCard } from './HoverCard';
import { QA_BADGE } from './channels';
import { bodyLines, checkWord, firstFailing, mergesToday, whoIsOn } from './peekFacts';

/** An agent: what they're on, this task's cost, today's and the week's merges, and a 4-week trend. */
export function AgentPeek({ agent }: { agent: Agent }) {
  const now = Date.now();
  const c = agent.career;
  const rate = c && firstRoundRate(c);
  return (
    <PeekCard
      title={
        <>
          <span className="dot" style={{ background: agent.color }} /> {agent.name}
        </>
      }
      sub={c ? `${rank(c)} · ${agentPhrase(agent)}` : agentPhrase(agent)}
      stats={[
        ['This task', agent.prNumber ? `PR #${agent.prNumber}` : agent.issueNumber ? `#${agent.issueNumber}` : 'none'],
        ['Task cost', fmtUsd(agent.costUsd)],
        ...(c ? ([
          ['Merged today', mergesToday(c, now)],
          ['This week', mergesThisWeek(c, now)],
          ['First-round QA', rate === null ? '—' : `${Math.round(rate * 100)}%`],
        ] as [string, number | string][]) : []),
      ]}
      spark={c ? weeklySeries(c, now).merges : undefined}
      note={agent.issueTitle}
      actions={[{ label: agent.terminal ? 'Open terminal' : 'Open their window', onSelect: () => useStore.getState().openOverlay({ kind: 'terminal', agentId: agent.id }) }]}
    />
  );
}

/** An issue or PR of a floor: its state, who's on it, QA's round and checks, labels and the body's first lines. */
export function WorkPeek({ repo, n }: { repo: RepoView; n: number }) {
  const agents = useStore((s) => s.agents);
  const pull = repo.pulls.find((p) => p.number === n);
  const issue = repo.issues.find((i) => i.number === n);
  const qa = useStore((s) => (pull ? s.qa[qaKey(repo.id, n)] : undefined));
  const who = whoIsOn(repo.id, n, Object.values(agents), qa);
  const fail = firstFailing(qa?.checks);
  return (
    <PeekCard
      title={`${pull ? 'PR' : 'Issue'} #${n} ${pull?.title ?? issue?.title ?? ''}`}
      sub={pull ? `${pull.isDraft ? 'draft' : pull.state.toLowerCase()} · +${pull.additions} −${pull.deletions}` : issue ? 'open issue' : 'not on the board'}
      stats={[
        ["Who's on it", who.length ? who.join(', ') : 'nobody yet'],
        ...(pull ? ([['Checks', pull.failedChecks.length ? `✗ ${pull.failedChecks.map((c) => c.name).slice(0, 3).join(', ')}` : pull.checks]] as [string, string][]) : []),
        ...(qa ? ([['QA', `${QA_BADGE[qa.status]} · round ${qa.round}`]] as [string, string][]) : []),
      ]}
      note={fail ? `✗ ${fail.name}: ${fail.line}` : qa?.summary || (issue ? bodyLines(issue.body).join(' ') : null)}
    >
      {issue && issue.labels.length > 0 && (
        <div className="peek-chips">
          {issue.labels.slice(0, 5).map((l) => (
            <span key={l} className="chip">
              {l}
            </span>
          ))}
        </div>
      )}
    </PeekCard>
  );
}

/** QA's verdict on a PR: each check with its state, and the first failing line. */
export function QaPeek({ qa }: { qa: QaView }) {
  const fail = firstFailing(qa.checks);
  return (
    <PeekCard title={`QA on PR #${qa.prNumber}: ${QA_BADGE[qa.status]}`} sub={`round ${qa.round}${qa.mergeNote ? ` · ${qa.mergeNote}` : ''}`} note={qa.summary}>
      {qa.checks.length > 0 && (
        <ul className="peek-checks">
          {qa.checks.slice(0, 6).map((c) => (
            <li key={c.name} className={`peek-check-${c.result}`}>
              {checkWord(c.result)} <b>{c.name}</b>
            </li>
          ))}
        </ul>
      )}
      {fail && (
        <p className="peek-check-fail">
          First failure, {fail.name}: {fail.line}
        </p>
      )}
    </PeekCard>
  );
}
