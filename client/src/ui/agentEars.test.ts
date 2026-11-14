import { describe, expect, it } from 'vitest';
import { Utterances } from './agentEars';

// The browser's results as utterances (#658): a settled phrase is sent once, words still being said never are.
describe('utterances from the browser recognition', () => {
  it('sends a final phrase once and shows interim words without sending them', () => {
    const u = new Utterances();
    expect(u.results([{ transcript: 'ship the', final: false }])).toEqual({ send: '', interim: 'ship the' });
    expect(u.results([{ transcript: 'ship the login page', final: true }])).toEqual({ send: 'ship the login page', interim: '' });
    expect(u.results([{ transcript: 'ship the login page', final: true }])).toEqual({ send: '', interim: '' }); // the same result again
    expect(u.results([{ transcript: 'ship the login page', final: true }, { transcript: 'today', final: false }])).toEqual({ send: '', interim: 'today' });
  });

  it('flushes quiet interim words once; when the recognizer settles or extends them, only new words go', () => {
    const u = new Utterances();
    u.results([{ transcript: "what's the office", final: false }]);
    expect(u.flush()).toBe("what's the office");
    expect(u.flush()).toBe('');
    expect(u.results([{ transcript: "what's the office", final: true }]).send).toBe('');
    expect(u.results([{ transcript: "what's the office", final: true }, { transcript: 'doing now', final: true }]).send).toBe('doing now');
    u.reset(); // a new recognition counts from 0
    expect(u.results([{ transcript: 'hello', final: true }]).send).toBe('hello');
  });

  it('never sends an earlier final again in place of a new one (msgs 4626/4629)', () => {
    const u = new Utterances();
    expect(u.results([{ transcript: 'ship the login page', final: true }]).send).toBe('ship the login page');
    // phones repeat a settled phrase at a new index, and replay the last one after a restart
    expect(u.results([{ transcript: 'ship the login page', final: true }, { transcript: 'Ship the login page.', final: true }]).send).toBe('');
    u.reset();
    expect(u.results([{ transcript: 'ship the login page', final: true }]).send).toBe('');
    expect(u.results([{ transcript: 'ship the login page', final: true }, { transcript: 'and the signup one', final: true }]).send).toBe('and the signup one');
  });
});
