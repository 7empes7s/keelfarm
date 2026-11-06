// Where a notice goes (#107), pure: its body's jump (the chat refs' jumps, #26) and what each of its actions does,
// mapped to the panels and api calls the office already has. Notices.tsx runs them.
import { CEO_ID, type NoticeAction, type NoticeView } from '../../../shared/types';
import { jumpFor, type Jump, type RefWorld } from './chatRefs';

/** What tapping a notice or one of its buttons does. */
export type NoticeStep =
  | Jump
  | { kind: 'chat' }
  | { kind: 'approvals'; requestId?: string }
  | { kind: 'call'; call: 'approve'; requestId: string }
  | { kind: 'call'; call: 'reset' | 'ceoRetry'; agentId: string }
  | null;

/** Tapping the notice itself: its target, else the chat (the CEO) or the approvals (a team change). */
export function noticeJump(n: Pick<NoticeView, 'kind' | 'target' | 'requestId'>, mode: 'office' | 'pocket', w: RefWorld): NoticeStep {
  if (n.target && n.kind !== 'approval') return jumpFor({ ...n.target, start: 0, end: 0 }, mode, w);
  if (n.kind === 'ceo') return { kind: 'chat' };
  if (n.kind === 'approval') return { kind: 'approvals', ...(n.requestId && { requestId: n.requestId }) };
  return n.target ? jumpFor({ ...n.target, start: 0, end: 0 }, mode, w) : null;
}

/** One of its buttons, or null when what it needs is gone (the PR's floor, the agent). */
export function noticeStep(a: NoticeAction, n: Pick<NoticeView, 'target' | 'requestId'>, mode: 'office' | 'pocket', w: RefWorld): NoticeStep {
  const t = n.target;
  const pr = t && (t.kind === 'issue' || t.kind === 'qa') ? t : null;
  const agentId = t?.kind === 'agent' ? t.agentId : null;
  switch (a) {
    case 'openPr': {
      const repo = pr && w.repos.find((r) => r.id === pr.repoId);
      return repo ? { kind: 'url', url: `https://github.com/${repo.fullName}/pull/${pr.number}` } : null;
    }
    case 'openQa':
      return pr ? jumpFor({ kind: 'qa', repoId: pr.repoId, number: pr.number, start: 0, end: 0 }, mode, w) : null;
    case 'terminal':
      return agentId ? jumpFor({ kind: 'agent', agentId, terminal: true, start: 0, end: 0 }, mode, w) : null;
    case 'retry':
      return agentId && w.agents[agentId] ? { kind: 'call', call: agentId === CEO_ID ? 'ceoRetry' : 'reset', agentId } : null;
    case 'reply':
      return { kind: 'chat' };
    case 'approvals':
      return { kind: 'approvals', ...(n.requestId && { requestId: n.requestId }) };
    case 'approve':
      return n.requestId ? { kind: 'call', call: 'approve', requestId: n.requestId } : null;
  }
}
