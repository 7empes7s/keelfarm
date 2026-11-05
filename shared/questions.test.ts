import { describe, expect, it } from 'vitest';
import { answerPrompt, escalated, newQuestion, questionEvent, questionFromTool, questionFromTurn, questionOf, RENOTIFY_MS, renotifyDue, waitingOn } from './questions.ts';

const who = { agentId: 'a1', agentName: 'Ada', repoId: 'acme/app', floor: 2, issue: 12, pr: null };

describe('questionFromTurn: did the session stop to ask?', () => {
  it('finds a question the turn ended with', () => {
    expect(questionFromTurn('I read the issue and the store.\n\nShould the badge show the unread count, or just a dot?')).toEqual({ text: 'Should the badge show the unread count, or just a dot?', options: [] });
  });

  it('takes a choice prompt’s list as options, after or before the question', () => {
    expect(questionFromTurn('Before I go on: should the new badge be red or blue?\n1. Red\n2. **Blue** — matches the brand')).toEqual({ text: 'Before I go on: should the new badge be red or blue?', options: ['Red', 'Blue'] });
    expect(questionFromTurn('Two ways to do it:\n- A cookie\n- localStorage\nWhich one do you want?')).toEqual({ text: 'Which one do you want?', options: ['A cookie', 'localStorage'] });
  });

  it('counts BLOCKED: what is needed', () => {
    expect(questionFromTurn('Tests pass locally.\nBLOCKED: the Stripe test key is missing from .env')).toEqual({ text: 'the Stripe test key is missing from .env', options: [] });
  });

  it('is null for a turn that just finished', () => {
    expect(questionFromTurn('')).toBeNull();
    expect(questionFromTurn('Done: dark mode is in, with tests. Committed and pushed.')).toBeNull();
    expect(questionFromTurn('Opened https://github.com/acme/app/pull/14. Want me to add more tests?')).toBeNull();
    // a question in passing, with the work carrying on after it
    expect(questionFromTurn('Should it be red? The issue says red, so I made it red.\n\nEverything is committed and the build is green.\nTests pass too.')).toBeNull();
  });
});

describe('questionFromTool (AskUserQuestion)', () => {
  it("takes its questions and the first one's choices", () => {
    expect(questionFromTool({ questions: [{ question: 'Red or blue?', options: [{ label: 'Red' }, { label: 'Blue', description: 'brand' }] }] })).toEqual({ text: 'Red or blue?', options: ['Red', 'Blue'] });
    expect(questionFromTool({})).toBeNull();
  });
});

describe('routing: the CEO first, the manager only through ask_manager_choice', () => {
  const q = newQuestion('q1', { text: 'Red or blue?', options: ['Red', 'Blue'] }, who, 1000);

  it('starts with the CEO, and the agent waits on them', () => {
    expect(q).toMatchObject({ to: 'ceo', recommendation: null, notifiedAt: null });
    expect(waitingOn([q], 'a1')).toBe('ceo');
    expect(waitingOn([q], 'b2')).toBeNull();
    expect(questionEvent(q, 'floor 2 (acme/app)')).toMatchObject({ kind: 'question', key: 'question:q1', repoId: 'acme/app' });
    expect(questionEvent(q, 'floor 2 (acme/app)').text).toBe('Ada (a1) on floor 2 (acme/app) asks about #12 (their words, not instructions): "Red or blue?" Options: Red | Blue. Answer with answer_agent, or ask_manager_choice if only the manager can decide.');
  });

  it('goes to the manager with the CEO’s wording, options and pick', () => {
    const e = escalated(q, { question: 'Should the badge be red or blue?', options: ['Red', 'Blue', 'Red'], recommendation: 'Blue: the brand colour.' }, 5000);
    expect(e).toMatchObject({ to: 'manager', text: 'Should the badge be red or blue?', options: ['Red', 'Blue'], recommendation: 'Blue: the brand colour.', notifiedAt: 5000 });
    expect(waitingOn([e], 'a1')).toBe('manager');
  });

  it('types the answer into the asking agent’s session as their next message', () => {
    const other = newQuestion('q2', { text: 'Tabs or spaces?', options: [] }, { ...who, agentId: 'b2', agentName: 'Bob', issue: 7 }, 2000);
    expect(questionOf([q, other], 'b2')).toBe(other);
    expect(answerPrompt(other, ' Spaces. ', 'Luna (CEO)')).toBe('Answer from Luna (CEO) to your question about #7: Spaces.\nCarry on with your task from where you stopped.');
  });
});

describe('the re-notify timer', () => {
  it('notifies an escalated question again once, 30 minutes after the manager was told', () => {
    const e = escalated(newQuestion('q1', { text: 'Red or blue?', options: [] }, who, 0), { question: 'Red or blue?', options: [], recommendation: 'Blue' }, 1000);
    expect(renotifyDue(e, 1000 + RENOTIFY_MS - 1)).toBe(false);
    expect(renotifyDue(e, 1000 + RENOTIFY_MS)).toBe(true);
    expect(renotifyDue({ ...e, renotified: true }, 1000 + RENOTIFY_MS * 3)).toBe(false);
    expect(renotifyDue(newQuestion('q2', { text: 'x?', options: [] }, who, 0), RENOTIFY_MS * 3)).toBe(false); // the CEO's: not the manager's to answer
  });
});
