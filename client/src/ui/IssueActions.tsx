// Shared by the console and CardView, including pocket mode and chat references.
import { useState } from 'react';
import type { RepoView } from '../../../shared/types';
import { blockers } from '../../../shared/issues';
import { api } from '../api';
import { agentsOnRepo, isBusy, useStore } from '../store';
import { AssignButton } from './AssignSheet';
import { confirmDialog } from './Confirm';
import { stopAgent } from './dangerActions';
import { go } from './goTo';
import { issueActions } from './issueActionRules';
import { Menu } from './Menu';

export function IssueActions({ repo, number }: { repo: RepoView; number: number }) {
  const all = useStore((s) => s.agents);
  const [busy, setBusy] = useState(false);
  const issue = repo.issues.find((i) => i.number === number);
  const pr = repo.pulls.some((p) => p.state === 'OPEN' && !p.untrusted && p.closesIssues.includes(number));
  const onIt = agentsOnRepo(all, repo.id).sort((a, b) => Number(isBusy(b)) - Number(isBusy(a))).filter((a) => a.role !== 'ceo' && a.task !== 'qa' && a.issueNumber === number && a.status !== 'idle');
  // Its builder; once a PR is open, whoever holds it (usually fixing that PR).
  const agent = onIt.find((a) => a.task === 'issue' && a.prNumber == null) ?? (pr ? onIt[0] : undefined);
  const waits = issue ? blockers(issue.body, new Set(repo.issues.map((i) => i.number))) : [];
  const actions = issueActions({ open: !!issue, pr, untrusted: issue?.untrusted, agentStatus: agent?.status, waits });
  if (!issue || !actions.close) return null;
  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try { await fn(); } catch { /* api already toasted */ } finally { setBusy(false); }
  };
  const close = async () => {
    let reason = '';
    const ok = await confirmDialog({
      tone: 'danger', title: `Close #${number}?`, confirm: 'Close issue',
      body: <>
        <p>“{issue.title}” will be closed on GitHub as not planned.{actions.stop ? ' The running session continues; the CEO reviews your change. Use Stop to end it now.' : ''}</p>
        <input aria-label="Reason for closing" placeholder="Short reason" maxLength={500} onChange={(e) => { reason = e.target.value; }} />
      </>,
    });
    if (!ok) return;
    if (!reason.trim()) {
      useStore.getState().pushToast('error', 'Add a short reason before closing the issue.');
      return;
    }
    await act(() => api.closeIssue(repo.id, number, reason.trim()));
  };
  return <>
    {actions.primary === 'agent' && agent && <button type="button" className="btn btn-good" onClick={() => go({ kind: 'overlay', overlay: { kind: 'terminal', agentId: agent.id } })}>Open {agent.name}</button>}
    {actions.assign && <AssignButton repoId={repo.id} number={number} title={issue.title} primary={actions.primary === 'assign'} />}
    <Menu label={`More for issue #${number}`} title={`#${number} ${issue.title}`} items={[
      ...(actions.stop && agent ? [{ label: `Stop ${agent.name}…`, danger: true, disabled: busy, onSelect: () => void act(() => stopAgent(agent)) }] : []),
      { label: 'Close as not planned…', hint: 'Closes it on GitHub with your reason', danger: true, disabled: busy, onSelect: () => void close() },
    ]} />
  </>;
}
