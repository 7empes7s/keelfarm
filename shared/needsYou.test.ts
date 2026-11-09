import { describe, expect, it } from 'vitest';
import { needsYou, needsYouLine, shownState } from './needsYou.ts';

describe('needs you (#307)', () => {
  it('is on while their question waits on the manager or the watchdog reports a prompt it could not answer', () => {
    expect(needsYou({ status: 'done', waiting: 'manager' })).toBe('question');
    expect(needsYou({ status: 'working', blocked: "a permission prompt the office couldn't answer" })).toBe('prompt');
    expect(needsYou({ status: 'idle', needsSignIn: true })).toBe('sign-in');
  });

  it('is off while they work, wait on the CEO, or have answered and gone back to work', () => {
    expect(needsYou({ status: 'working' })).toBeNull();
    expect(needsYou({ status: 'done', waiting: 'ceo' })).toBeNull();
    expect(needsYou({ status: 'working', waiting: 'manager' })).toBeNull(); // answered: back at work
    expect(needsYou({ status: 'done', blocked: 'old prompt' })).toBeNull(); // the session ended: nothing on screen
  });

  it('shows a finished agent with nothing to do as free, not done', () => {
    expect(shownState({ status: 'done' })).toBe('free');
    expect(shownState({ status: 'idle' })).toBe('free');
    expect(shownState({ status: 'done', waiting: 'manager' })).toBe('needs-you');
    expect(shownState({ status: 'working', blocked: 'x' })).toBe('needs-you');
    expect(shownState({ status: 'done', waiting: 'ceo' })).toBe('waiting-ceo');
    expect(shownState({ status: 'working' })).toBe('working');
    expect(shownState({ status: 'error' })).toBe('error');
  });

  it('says plainly what the manager has to do', () => {
    expect(needsYouLine('Ada', 'question')).toBe("Needs you: answer Ada's question");
    expect(needsYouLine('Ada', 'prompt')).toBe("Needs you: answer the prompt in Ada's terminal");
  });
});
