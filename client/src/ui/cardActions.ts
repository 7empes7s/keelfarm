// Every Kanban card's actions (#232, #410): its state's one primary button (Merge, Retry QA…), the action bar (Open the
// card, GitHub, Terminal while an agent is on it, Preview while one runs) and what goes in the ⋯ menu (danger last).
// Plus the status chip and the who row's one-line phrase. Pure.
import type { QaStatus } from '../../../shared/types';

export type CardState = 'issue' | 'testing' | 'fixing' | 'needs-you' | 'waiting' | 'ready' | 'untrusted';
export type CardAction = 'open' | 'github' | 'preview' | 'terminal' | 'history' | 'qa-report' | 'send-to-qa' | 'retry-qa' | 'send-back' | 'merge' | 'merge-anyway' | 'close';

/** A PR card's state, from its column and QA record. */
export function cardState(col: 'qa' | 'ready', status: QaStatus | undefined, untrusted?: boolean): CardState {
  if (untrusted) return 'untrusted';
  if (col === 'ready') return 'ready';
  if (status === 'testing') return 'testing';
  if (status === 'fixing' || status === 'failed') return 'fixing';
  if (status === 'needs-human') return 'needs-you';
  return 'waiting';
}

/** The status chip in a PR card's header. */
export const STATE_LABEL: Record<CardState, string> = { issue: 'Issue', testing: 'Testing', fixing: 'Fixing', 'needs-you': 'Needs you', waiting: 'Waiting', ready: 'Ready', untrusted: 'Outsider' };

// The one button that moves the card on, when its state has one.
const PRIMARY: Partial<Record<CardState, CardAction>> = { 'needs-you': 'retry-qa', waiting: 'send-to-qa', ready: 'merge' };

// What a state offers past the primary and the bar, in the ⋯'s order (Close is added last).
const MORE: Record<CardState, CardAction[]> = {
  issue: [],
  testing: ['preview', 'qa-report', 'history'],
  fixing: ['send-back', 'preview', 'qa-report', 'history'],
  'needs-you': ['send-back', 'preview', 'qa-report', 'history', 'merge-anyway'],
  waiting: ['preview', 'history', 'qa-report'],
  ready: ['preview', 'qa-report', 'history'],
  untrusted: [],
};

/** Hard to undo: always last in the menu, in its danger section. */
export const DANGER: ReadonlySet<CardAction> = new Set(['close']);

export interface CardFacts {
  /** Someone is on it, so it has a terminal to open. */
  agent?: boolean;
  /** Its PR's preview is running (or starting) in the PR theatre. */
  previewing?: boolean;
  /** QA posted a report on GitHub. */
  qaReport?: boolean;
  /** Nobody has tested it yet ("Send to QA" applies; a queued card is already on its way). */
  untested?: boolean;
  /** Only the failed and needs-you states can be sent back. */
  status?: QaStatus;
}

/** The primary button (or none), the action bar in order, and the ⋯ menu's items with the danger ones last (empty: no ⋯). */
export function cardActions(state: CardState, facts: CardFacts = {}): { primary: CardAction | null; bar: CardAction[]; menu: CardAction[] } {
  const outsider = state === 'untrusted';
  const bar: CardAction[] = ['open', 'github'];
  if (facts.agent && !outsider) bar.push('terminal');
  if (facts.previewing && !outsider && state !== 'issue') bar.push('preview');
  const available = (a: CardAction) => {
    if (a === 'qa-report') return !!facts.qaReport;
    if (a === 'send-to-qa') return !!facts.untested;
    if (a === 'send-back') return state === 'needs-you' || facts.status === 'failed';
    return true;
  };
  const p = PRIMARY[state];
  const primary = p && available(p) ? p : null;
  const menu = MORE[state].filter((a) => available(a) && !bar.includes(a));
  return { primary, bar, menu: state === 'issue' ? menu : [...menu, 'close'] };
}

/** The who row's words: a short form for the card (≤ `max` characters) and the long one for its tooltip. */
export function whoPhrase(name: string | undefined, note: string | undefined, max = 32): { short: string; long: string } {
  const long = [name, note].filter(Boolean).join(' · ');
  return { short: long.length > max ? `${long.slice(0, max - 1).trimEnd()}…` : long, long };
}
