import { describe, expect, it } from 'vitest';
import { heardDrop, selfIntro, type HeardCheck } from './callHeard';

const GREETING = "Hi, it's me, Mimoun. What can I do?";
const REPLY = "Sure. QA passed two pull requests this morning, and one is waiting on the CEO's review.";
const now = 100_000;
const check = (over: Partial<HeardCheck> = {}): HeardCheck => ({ spoken: [{ text: GREETING, at: now - 2000 }, { text: REPLY, at: now - 500 }], names: ['Mimoun'], sent: [], now, ...over });

describe('heardDrop (#694)', () => {
  it("drops the live call's fragments the manager never said", () => {
    expect(heardDrop("hi it's me moon what can I do", check())).toBe('self'); // the greeting, its name misheard
    expect(heardDrop('men', check())).toBe('noise');
    expect(heardDrop('on it', check())).toBe('noise');
    expect(heardDrop('um uh', check())).toBe('noise');
    expect(heardDrop('floor', check())).toBe('short');
    expect(heardDrop('what can I do', check())).toBe('echo');
    expect(heardDrop('QA passed 2 pull requests this morning', check())).toBe('echo');
  });

  it("keeps the manager's words, answers and commands", () => {
    expect(heardDrop('What is floor one doing?', check())).toBe('');
    expect(heardDrop('yes', check())).toBe('');
    expect(heardDrop('Stop.', check())).toBe('');
    expect(heardDrop('no stop that, merge the review one', check())).toBe('');
    expect(heardDrop('Why is QA so slow this week?', check())).toBe('');
    expect(heardDrop('is anything waiting on me', check({ spoken: [{ text: 'Nothing is waiting on you right now.', at: now }] }))).toBe(''); // a follow-up reusing the answer's words
  });

  it("forgets what the voice said a while ago, and drops quick repeats and unsure words", () => {
    expect(heardDrop('what can I do', check({ spoken: [{ text: GREETING, at: now - 60_000 }] }))).toBe('');
    expect(heardDrop('What is floor one doing', check({ sent: [{ text: 'what is floor one doing?', at: now - 3000 }] }))).toBe('repeat');
    expect(heardDrop('What is floor one doing', check({ sent: [{ text: 'what is floor one doing?', at: now - 20_000 }] }))).toBe('');
    expect(heardDrop('What is floor one doing', check({ confidence: 0.2 }))).toBe('unsure');
    expect(heardDrop('What is floor one doing', check({ confidence: 0 }))).toBe(''); // the browser gave none
  });

  it('knows the voice introducing itself', () => {
    expect(selfIntro("This is Mimoun, what's up", ['Mimoun'])).toBe(true);
    expect(selfIntro("hey it's me", [])).toBe(true);
    expect(selfIntro("it's me again, what about floor two", [])).toBe(false);
    expect(selfIntro("what's Mimoun's job", ['Mimoun'])).toBe(false);
  });
});
