import { describe, expect, it } from 'vitest';
import {
  DECISION_TTL_MS,
  QUIET_AFTER,
  SNOOZE_MS,
  chatDecisions,
  closeDecision,
  decisionsForCeo,
  digestDue,
  fromCeoMessage,
  loadDecisions,
  onManagerMessage,
  questionLine,
  shownDecisions,
  snoozeDecision,
  syncDecisions,
  waitingDecisions,
  type Decision,
  type DecisionSeed,
} from './decisions';
import type { PhoneMessage } from './types';

const ceo = (id: number, text: string, suggestions?: string[], extra: Partial<PhoneMessage> = {}): PhoneMessage => ({ id, from: 'ceo', text, at: id * 1000, ...(suggestions && { suggestions }), ...extra });
const manager = (id: number, text: string, replyTo?: number): PhoneMessage => ({ id, from: 'manager', text, at: id * 1000, ...(replyTo !== undefined && { replyTo }) });
const ALERT = ['File the quieter alert fix', 'Lower the margin'];
const asked = (now = 1000) => fromCeoMessage([], ceo(1, 'The memory alert fired twice. Shall I file the fix, or lower the margin?', ALERT), now);
const world = (seeds: DecisionSeed[] = [], gone: (a: Decision['about'][number]) => boolean = () => false) => ({ seeds, gone });

describe('questionLine', () => {
  it('keeps the last question, in plain words', () => {
    expect(questionLine('Builds are **green**. Shall I keep the team on it? Say so.')).toBe('Shall I keep the team on it?');
    expect(questionLine('All quiet.\nPick one')).toBe('Pick one');
  });

  // #183: the two cards on the manager's phone (IMG_1969)
  it('drops list markers, bold and "What you need to do:" labels', () => {
    expect(questionLine('GitHub Actions stopped.\n\n- **What you need to do:** raise the spending limit, or drop the Windows CI job.')).toBe('Raise the spending limit, or drop the Windows CI job.');
    expect(questionLine('Status:\n1. **Next step:** shall I merge #12 now?')).toBe('Shall I merge #12 now?');
    expect(questionLine('> **Decision needed:** keep floor 2 on it? Say so.')).toBe('Keep floor 2 on it?');
  });

  it("prefers the CEO's sentence ending in a question mark over a later line", () => {
    expect(questionLine('Did you fix the GitHub payment?\n- The only blocker left is the failed GitHub payment.', ['Fixed it', 'Not yet'])).toBe('Did you fix the GitHub payment?');
  });

  it('without one, asks its options', () => {
    const text = 'Floor 3 #177 passed QA round 3, and I have escalated it to you. The only blocker left is the failed GitHub payment.';
    expect(questionLine(text, ['I fixed the payment', 'Skip Windows CI for now'])).toBe('I fixed the payment or skip Windows CI for now?');
    expect(questionLine('- What you need to do: raise the spending limit for GitHub Actions', ['Raised the limit', 'Drop the Windows CI job'])).toBe('Raised the limit or drop the Windows CI job?');
    expect(questionLine('Pick one.', ['CI on Windows', 'Ship it.'])).toBe('CI on Windows or ship it?');
  });
});

describe('fromCeoMessage', () => {
  it('opens a decision for a CEO message with suggestions, with its question, options, floors and what it is about', () => {
    const m = ceo(4, 'Floor 2 #12 is next. Keep them on it?', ['Yes', 'No'], { refs: [{ start: 0, end: 11, kind: 'issue', repoId: 'r2', number: 12 }] });
    const [d] = fromCeoMessage([], m, 5);
    expect(d).toMatchObject({ id: 'msg:4', kind: 'suggestion', question: 'Keep them on it?', options: ['Yes', 'No'], repoIds: ['r2'], about: [{ kind: 'issue', repoId: 'r2', number: 12 }], messageId: 4, askedAt: 5, raised: 1, status: 'open' });
  });

  it('leaves out messages without suggestions, team changes and agents\' questions', () => {
    expect(fromCeoMessage([], ceo(1, 'Hi'), 1)).toEqual([]);
    expect(fromCeoMessage([], ceo(1, 'Hire?', ['Yes'], { requestId: 'r' }), 1)).toEqual([]);
    expect(fromCeoMessage([], ceo(1, 'Red?', ['Red'], { question: 'q1' }), 1)).toEqual([]);
    expect(fromCeoMessage([], { ...ceo(1, 'x', ['Yes']), from: 'office' }, 1)).toEqual([]);
  });

  it('counts the same question asked again instead of opening a second one', () => {
    const again = fromCeoMessage(asked(), ceo(9, 'Still open: file the fix or lower the margin?', [...ALERT].reverse()), 9000);
    expect(again).toHaveLength(1);
    expect(again[0]).toMatchObject({ id: 'msg:1', messageId: 9, raised: 2, lastAskedAt: 9000, askedAt: 1000 });
    expect(fromCeoMessage(again, ceo(9, 'x', ALERT), 9500)).toBe(again); // the same message twice
  });

  it("uses the CEO's explicit question line, and keeps the message as the card's context", () => {
    const [d] = fromCeoMessage([], ceo(3, '- **What you need to do:** raise the spending limit.', ['Raised it'], { ask: 'Did you fix the GitHub payment?' }), 3);
    expect(d).toMatchObject({ question: 'Did you fix the GitHub payment?', context: 'Raise the spending limit.' });
  });

  it('a newer question on the same thing replaces the older one, which is marked superseded', () => {
    const older = fromCeoMessage([], ceo(1, 'GitHub Actions stopped: the payment for the account failed, so CI is red on every floor.\n- What you need to do: raise the spending limit for GitHub Actions in the billing settings.', ['Raised the limit', 'Drop the Windows CI job']), 1000);
    const newer = fromCeoMessage(older, ceo(2, 'Floor 3 #177 passed QA round 3. The only blocker left is the failed GitHub payment, so its CI is red.', ['I fixed the payment', 'Skip Windows CI for now']), 2000);
    expect(newer.map((d) => [d.id, d.status])).toEqual([['msg:1', 'superseded'], ['msg:2', 'open']]);
    expect(waitingDecisions(newer, 2000).map((d) => d.id)).toEqual(['msg:2']);
    expect(newer[0].outcome).toMatch(/^replaced by/);
  });

  it('leaves an older question on something else, or on other floors, open', () => {
    const r = (repoId: string) => ({ refs: [{ start: 0, end: 7, kind: 'floor' as const, repoId }] });
    const other = fromCeoMessage(asked(), ceo(2, 'The failed GitHub payment turned CI red. Did you raise the spending limit?', ['Raised it', 'Not yet']), 2000);
    expect(waitingDecisions(other, 2000)).toHaveLength(2);
    const pay = 'The failed GitHub payment turned CI red on this floor. Did you raise the spending limit?';
    const one = fromCeoMessage([], ceo(1, pay, ['Raised it', 'Not yet'], r('r1')), 1000);
    expect(waitingDecisions(fromCeoMessage(one, ceo(2, pay, ['Yes, raised', 'No'], r('r2')), 2000), 2000)).toHaveLength(2);
    expect(waitingDecisions(fromCeoMessage(one, ceo(2, pay, ['Yes, raised', 'No'], r('r1')), 2000), 2000)).toHaveLength(1);
    expect(waitingDecisions(fromCeoMessage(one, ceo(2, pay, ['Yes, raised', 'No']), 2000), 2000)).toHaveLength(1); // no floor named: any floor
  });

  it('never raises a dropped one again', () => {
    const dropped = closeDecision(asked(), 'msg:1', 'dropped', 'no', 2000);
    expect(fromCeoMessage(dropped, ceo(5, 'File it?', ALERT), 5000)).toBe(dropped);
  });
});

describe('onManagerMessage', () => {
  it('closes the decision a reply answers, with the answer', () => {
    const [d] = onManagerMessage(asked(), manager(2, 'Lower the margin', 1), 2000);
    expect(d).toMatchObject({ status: 'resolved', outcome: 'Lower the margin', closedAt: 2000 });
  });

  it('closes one whose option is said word for word, even without a reply', () => {
    expect(onManagerMessage(asked(), manager(2, 'file the quieter alert fix!'), 2000)[0].status).toBe('resolved');
  });

  it('leaves it open when the manager talks about something else', () => {
    const list = asked();
    expect(onManagerMessage(list, manager(2, 'How is floor 3 doing?'), 2000)).toBe(list);
    expect(onManagerMessage(list, ceo(2, 'Lower the margin'), 2000)).toBe(list);
  });
});

describe('snooze, drop and resolve', () => {
  it('Not now hides it for 24 hours, then it is back', () => {
    const list = snoozeDecision(asked(), 'msg:1', 1000);
    expect(waitingDecisions(list, 1000 + SNOOZE_MS - 1)).toEqual([]);
    expect(waitingDecisions(list, 1000 + SNOOZE_MS)).toHaveLength(1);
    expect(decisionsForCeo(list, 2000, () => 1)).toEqual([]);
  });

  it('Drop it and resolve_decision close it for good', () => {
    for (const status of ['dropped', 'resolved', 'superseded'] as const) {
      const list = closeDecision(asked(), 'msg:1', status, 'the CEO filed it', 2000);
      expect(list[0]).toMatchObject({ status, outcome: 'the CEO filed it' });
      expect(waitingDecisions(list, 3000)).toEqual([]);
      expect(decisionsForCeo(list, 3000, () => 1)).toEqual([]);
    }
  });
});

describe('syncDecisions', () => {
  const team: DecisionSeed = { id: 'team:r1', kind: 'team', question: 'Hire Ada on floor 1?', options: [], repoIds: ['repo1'], messageId: 3, at: 500 };
  const charter: DecisionSeed = { id: 'charter:repo1:7', kind: 'charter', question: "Floor 1's charter change", options: [], repoIds: ['repo1'], messageId: null, at: 7 };

  it('opens a decision for each team change, charter proposal and question waiting on the manager', () => {
    const list = syncDecisions([], world([team, charter]), 1000);
    expect(list.map((d) => [d.id, d.status, d.askedAt])).toEqual([['team:r1', 'open', 500], ['charter:repo1:7', 'open', 7]]);
    expect(syncDecisions(list, world([team, charter]), 2000)).toBe(list); // nothing changed
  });

  it('closes them once decided (the seed is gone), and never reopens a closed one', () => {
    const list = syncDecisions([], world([team, charter]), 1000);
    const decided = syncDecisions(list, world([charter]), 2000);
    expect(decided.find((d) => d.id === 'team:r1')).toMatchObject({ status: 'resolved', outcome: 'decided' });
    const dropped = closeDecision(decided, 'charter:repo1:7', 'dropped', 'no', 3000);
    expect(syncDecisions(dropped, world([charter]), 4000)).toBe(dropped);
  });

  it('closes a suggestion once everything it is about is gone', () => {
    const list = fromCeoMessage([], ceo(1, '#3 and @Ada: merge?', ['Yes'], { refs: [{ start: 0, end: 2, kind: 'issue', repoId: 'r', number: 3 }, { start: 7, end: 11, kind: 'agent', agentId: 'a1' }] }), 1000);
    expect(syncDecisions(list, world([], (a) => a.kind === 'issue'), 2000)).toBe(list);
    expect(syncDecisions(list, world([], () => true), 2000)[0]).toMatchObject({ status: 'resolved', outcome: 'what it was about is gone' });
    const plain = asked(); // about nothing in particular: it stays
    expect(syncDecisions(plain, world([], () => true), 2000)).toBe(plain);
  });

  it('archives one left unanswered for 7 days, without deleting it', () => {
    const list = syncDecisions(asked(1000), world(), 1000 + DECISION_TTL_MS + 1);
    expect(list).toHaveLength(1);
    expect(list[0].status).toBe('archived');
    expect(shownDecisions(list)).toHaveLength(1);
    expect(waitingDecisions(list, Date.now())).toEqual([]);
  });

  it('keeps the latest 50 closed ones', () => {
    let list: Decision[] = [];
    for (let i = 0; i < 60; i++) list = closeDecision(fromCeoMessage(list, ceo(i, `Q${i}?`, [`A${i}`]), i), `msg:${i}`, 'resolved', 'ok', i);
    const kept = syncDecisions(list, world(), 100);
    expect(kept).toHaveLength(50);
    expect(kept.some((d) => d.id === 'msg:0')).toBe(false);
  });
});

describe('what the CEO and the tabs get', () => {
  it("lists the open ones for company_status, marking one asked twice as tray only", () => {
    const twice = fromCeoMessage(asked(), ceo(5, 'File or lower?', ALERT), 5000);
    const [d] = decisionsForCeo(twice, 3_600_000 + 1000, () => 2);
    expect(d).toEqual({ id: 'msg:1', question: 'File or lower?', options: ALERT, askedHoursAgo: 1, trayOnly: true });
    expect(QUIET_AFTER).toBe(2);
    expect(decisionsForCeo(asked(), 1000, () => 2)[0]).not.toHaveProperty('trayOnly');
  });

  it("the chat's questions are the suggestions and agents' questions", () => {
    const list = syncDecisions(asked(), world([{ id: 'team:x', kind: 'team', question: 'Hire?', options: [], repoIds: [], messageId: null, at: 1 }]), 1000);
    expect(chatDecisions(list, 1000).map((d) => d.id)).toEqual(['msg:1']);
  });

  it('a digest at most once a day, only with something waiting', () => {
    const day = 24 * 3_600_000;
    expect(digestDue({ list: asked(), digestAt: 0 }, day)).toBe(1);
    expect(digestDue({ list: asked(), digestAt: day }, 2 * day - 1)).toBe(0);
    expect(digestDue({ list: [], digestAt: 0 }, day)).toBe(0);
  });

  it('loads saved state, dropping what is malformed', () => {
    expect(loadDecisions(undefined)).toEqual({ list: [], digestAt: 0 });
    expect(loadDecisions({ list: [...asked(), { id: 3 }], digestAt: 9 })).toEqual({ list: asked(), digestAt: 9 });
  });
});
