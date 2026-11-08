// One action row for every Kanban PR card (#232): which two buttons show, chosen by the card's state with the primary
// first, and what goes in the ⋯ menu (danger last). Plus the who row's one-line phrase. Pure.
import type { QaStatus } from '../../../shared/types';

export type CardState = 'testing' | 'fixing' | 'needs-you' | 'waiting' | 'ready' | 'untrusted';
export type CardAction = 'preview' | 'terminal' | 'history' | 'qa-report' | 'send-to-qa' | 'retry-qa' | 'send-back' | 'merge' | 'merge-anyway' | 'review' | 'close';

/** A PR card's state, from its column and QA record. */
export function cardState(col: 'qa' | 'ready', status: QaStatus | undefined, untrusted?: boolean): CardState {
  if (untrusted) return 'untrusted';
  if (col === 'ready') return 'ready';
  if (status === 'testing') return 'testing';
  if (status === 'fixing' || status === 'failed') return 'fixing';
  if (status === 'needs-human') return 'needs-you';
  return 'waiting';
}

// Every action a state offers, in order: the first two that are available show, the rest go in the ⋯.
const ORDER: Record<CardState, CardAction[]> = {
  testing: ['preview', 'terminal', 'qa-report', 'history'],
  fixing: ['terminal', 'preview', 'send-back', 'qa-report', 'history'],
  'needs-you': ['retry-qa', 'preview', 'send-back', 'qa-report', 'history', 'merge-anyway'],
  waiting: ['preview', 'history', 'send-to-qa', 'qa-report'],
  ready: ['merge', 'preview', 'qa-report', 'history'],
  untrusted: ['review'],
};

/** Hard to undo: always last in the menu, in its danger section. */
export const DANGER: ReadonlySet<CardAction> = new Set(['close']);

export interface CardFacts {
  /** Someone is on it, so it has a terminal to open. */
  agent?: boolean;
  /** QA posted a report on GitHub. */
  qaReport?: boolean;
  /** Nobody has tested it yet ("Send to QA" applies; a queued card is already on its way). */
  untested?: boolean;
  /** Only the failed and needs-you states can be sent back. */
  status?: QaStatus;
}

/** The (at most) two visible buttons, primary first, and the ⋯ menu's items with the danger ones last. */
export function cardActions(state: CardState, facts: CardFacts = {}): { visible: CardAction[]; menu: CardAction[] } {
  const available = (a: CardAction) => {
    if (a === 'terminal') return !!facts.agent;
    if (a === 'qa-report') return !!facts.qaReport;
    if (a === 'send-to-qa') return !!facts.untested;
    if (a === 'send-back') return state === 'needs-you' || facts.status === 'failed';
    return true;
  };
  const all = ORDER[state].filter(available);
  return { visible: all.slice(0, 2), menu: [...all.slice(2), 'close'] };
}

/** The who row's words: a short form for the card (≤ `max` characters) and the long one for its tooltip. */
export function whoPhrase(name: string | undefined, note: string | undefined, max = 32): { short: string; long: string } {
  const long = [name, note].filter(Boolean).join(' · ');
  return { short: long.length > max ? `${long.slice(0, max - 1).trimEnd()}…` : long, long };
}
