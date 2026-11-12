// Where a problem's links go (#544): its PR (QA's page), its issue and its agent, as chat refs, so the Problems page and
// the digest card open them the way a chat chip does (chatRefs.ts jumpFor). Pure.
import type { ChatRef } from '../../../shared/types';
import type { Problem } from '../../../shared/problems';
import { jumpFor, type RefWorld } from './chatRefs';
import type { Target } from './goTo';
import type { IconName } from './icons';

export interface ProblemLink {
  label: string;
  icon: IconName;
  ref: ChatRef;
}

/** The PR, the issue and the agent a problem names. */
export function problemLinks(p: Pick<Problem, 'repoId' | 'pr' | 'issue' | 'agentId'> & { agentName?: string }): ProblemLink[] {
  const at = { start: 0, end: 0 };
  const out: ProblemLink[] = [];
  if (p.repoId && p.pr !== null) out.push({ label: `PR #${p.pr}`, icon: 'git-pull-request', ref: { ...at, kind: 'qa', repoId: p.repoId, number: p.pr } });
  if (p.repoId && p.issue !== null) out.push({ label: `Issue #${p.issue}`, icon: 'notebook-pen', ref: { ...at, kind: 'issue', repoId: p.repoId, number: p.issue } });
  if (p.agentId) out.push({ label: p.agentName ?? 'Agent', icon: 'user', ref: { ...at, kind: 'agent', agentId: p.agentId } });
  return out;
}

/** Where a link goes outside the chat: a panel or GitHub; null when what it names is gone. */
export function linkTarget(ref: ChatRef, world: RefWorld, mode: 'office' | 'pocket'): Target | null {
  const j = jumpFor(ref, mode, world);
  if (j?.kind === 'overlay') return { kind: 'overlay', overlay: j.overlay };
  if (j?.kind === 'url') return { kind: 'link', url: j.url };
  return null;
}
