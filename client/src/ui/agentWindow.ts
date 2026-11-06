// The agent window's header and details (#117): the status ring round their avatar, the task as one line, this task's
// steps for the Now tab's timeline, and when a swipe opens or closes the details sheet. Pure; TerminalView.tsx and
// the team lists use it.
import type { AgentView, QaView } from '../../../shared/types';

export type Ring = 'working' | 'qa' | 'fixing' | 'idle' | 'error' | 'waiting';

/** The ring round their avatar: colour, an icon and a label, so it never relies on colour alone. */
export function ringStatus(a: Pick<AgentView, 'status' | 'task' | 'waiting' | 'blocked'>): { ring: Ring; icon: string; label: string } {
  if (a.status === 'error' || (a.blocked && a.status === 'working')) return { ring: 'error', icon: '!', label: a.status === 'error' ? 'Needs help' : 'Blocked' };
  if (a.waiting && a.status !== 'working') return { ring: 'waiting', icon: '?', label: a.waiting === 'ceo' ? 'Waiting for the CEO' : 'Waiting for you' };
  if (a.status === 'working' || a.status === 'preparing') {
    if (a.task === 'qa') return { ring: 'qa', icon: '🔍', label: 'Testing' };
    if (a.task === 'fix') return { ring: 'fixing', icon: '🔧', label: 'Fixing' };
    return { ring: 'working', icon: '●', label: a.status === 'preparing' ? 'Setting up' : 'Working' };
  }
  if (a.status === 'done') return { ring: 'idle', icon: '✓', label: 'Done' };
  if (a.status === 'stopped') return { ring: 'idle', icon: '■', label: 'Stopped' };
  return { ring: 'idle', icon: '○', label: 'Free' };
}

/** The task as one line: "Building #1059 · Access package…", "Testing PR #12 · …", "Free". */
export function taskLine(a: Pick<AgentView, 'status' | 'task' | 'issueNumber' | 'issueTitle' | 'prNumber'>): string {
  if (a.status === 'idle') return 'Free · pick work in Details';
  const title = a.issueTitle ? ` · ${a.issueTitle}` : '';
  if (a.task === 'qa') return `Testing PR #${a.prNumber ?? '?'}${title}`;
  if (a.task === 'fix') return `Fixing PR #${a.prNumber ?? '?'}${title}`;
  if (a.issueNumber != null) return `${a.status === 'done' ? 'Built' : 'Building'} #${a.issueNumber}${title}`;
  return a.status === 'done' ? 'Finished' : 'Nothing assigned';
}

export interface Step {
  label: string;
  state: 'done' | 'now' | 'next';
}

/** This task's steps for the Now tab: build → PR → QA round N → fix (→ QA again), the current one marked. */
export function taskSteps(a: Pick<AgentView, 'status' | 'task' | 'prNumber'>, qa: Pick<QaView, 'status' | 'round'> | undefined): Step[] {
  if (a.status === 'idle' || !a.task) return [];
  const busy = a.status === 'working' || a.status === 'preparing';
  const round = qa?.round ?? 1;
  const steps: Step[] = [{ label: 'Build', state: a.task === 'issue' && busy && !a.prNumber ? 'now' : 'done' }];
  steps.push({ label: a.prNumber ? `PR #${a.prNumber}` : 'PR', state: a.prNumber ? 'done' : 'next' });
  if (a.task === 'fix') {
    steps.push({ label: `QA round ${round}`, state: 'done' }, { label: 'Fix', state: busy ? 'now' : 'done' }, { label: `QA round ${round + 1}`, state: 'next' });
    return steps;
  }
  const qaNow = a.task === 'qa' ? busy : qa?.status === 'testing';
  const qaDone = qa?.status === 'passed' || qa?.status === 'failed' || qa?.status === 'fixing' || qa?.status === 'needs-human' || (a.task === 'qa' && !busy);
  steps.push({ label: `QA round ${round}`, state: qaDone ? 'done' : qaNow ? 'now' : 'next' });
  if (qa?.status === 'failed' || qa?.status === 'fixing') steps.push({ label: 'Fix', state: qa.status === 'fixing' ? 'now' : 'next' });
  else if (qa?.status === 'passed') steps.push({ label: 'Merge', state: 'next' });
  return steps;
}

/** Past this many px a drag on the sheet's handle or the header counts as a swipe. */
export const SWIPE_PX = 40;

/** Whether the details sheet is open after a vertical drag of `dy` px (down is positive); a short drag is a tap and toggles. */
export function sheetAfterDrag(open: boolean, dy: number): boolean {
  if (dy <= -SWIPE_PX) return true;
  if (dy >= SWIPE_PX) return false;
  return !open;
}
