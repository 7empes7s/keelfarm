// Where a notice goes (#107), pure: its body's jump (the chat refs' jumps, #26) and what each of its actions does,
// mapped to the panels and api calls the office already has. Notices.tsx runs them.
import { CEO_ID, type NoticeAction, type NoticeView } from '../../../shared/types';
import { jumpFor, type Jump, type RefWorld } from './chatRefs';
import { prPage } from './prNav';

/** What tapping a notice or one of its buttons does. */
export type NoticeStep =
  | Jump
  | { kind: 'chat' }
  | { kind: 'itApproval'; id: string }
  | { kind: 'approvals'; requestId?: string }
  | { kind: 'keys' } // Settings → Providers with the found keys' review open (#367)
  | { kind: 'call'; call: 'approve'; requestId: string }
  | { kind: 'call'; call: 'reset' | 'ceoRetry'; agentId: string }
  | null;

/** IT's cards (#580): the IT department's page. */
export const itApprovalJump = (id?: string): NoticeStep => id ? { kind: 'itApproval', id } : { kind: 'overlay', overlay: { kind: 'manager', tab: 'it-dept' } };

/** Tapping the notice itself: its target, else the chat (the CEO) or the approvals (a team change). */
export function noticeJump(n: Pick<NoticeView, 'kind' | 'target' | 'requestId'>, mode: 'office' | 'pocket', w: RefWorld): NoticeStep {
  if (n.kind === 'setup') return noticeStep('setup', n, mode, w);
  if (n.target?.kind === 'qa') return prJump(n.target, mode, w); // a PR's notice opens its page; its QA report button the preview (#407)
  if (n.target && n.kind !== 'approval') return jumpFor({ ...n.target, start: 0, end: 0 }, mode, w);
  if (n.kind === 'ceo') return { kind: 'chat' };
  if (n.kind === 'approval') return { kind: 'approvals', ...(n.requestId && { requestId: n.requestId }) };
  if (n.kind === 'keys') return { kind: 'keys' };
  if (n.kind === 'it') return itApprovalJump(n.requestId);
  return n.target ? jumpFor({ ...n.target, start: 0, end: 0 }, mode, w) : null;
}

/** A PR's page on the board, else (closed, or off the board) GitHub; null when its floor is gone. */
function prJump(pr: { repoId: string; number: number }, mode: 'office' | 'pocket', w: RefWorld): Jump | null {
  const repo = w.repos.find((r) => r.id === pr.repoId);
  if (!repo) return null;
  const overlay = prPage(repo, pr.number);
  if (!overlay) return { kind: 'url', url: `https://github.com/${repo.fullName}/pull/${pr.number}` };
  return { kind: 'overlay', overlay, ...(mode === 'office' && { floor: repo.floor }) };
}

/** One of its buttons, or null when what it needs is gone (the PR's floor, the agent). */
export function noticeStep(a: NoticeAction, n: Pick<NoticeView, 'target' | 'requestId'>, mode: 'office' | 'pocket', w: RefWorld): NoticeStep {
  const t = n.target;
  const pr = t && (t.kind === 'issue' || t.kind === 'qa') ? t : null;
  const agentId = t?.kind === 'agent' ? t.agentId : null;
  switch (a) {
    case 'openPr':
      return pr ? prJump(pr, mode, w) : null;
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
    case 'setup': // the floor's setup card (#366)
      return t?.kind === 'floor' && w.repos.some((r) => r.id === t.repoId) ? { kind: 'overlay', overlay: { kind: 'manager', tab: 'floors', repoId: t.repoId } } : null;
    case 'reviewKeys':
      return { kind: 'keys' };
    case 'openIt':
      return itApprovalJump(n.requestId);
  }
}
