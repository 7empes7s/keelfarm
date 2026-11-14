import { describe, expect, it } from 'vitest';
import { NO_BRAIN, brainTurn, repeatTurn, lastUserText, marker, MARKER, markerSay, wantsToEnd, type BrainFacts } from './voiceBrain';

const facts = (patch: Partial<BrainFacts> = {}): BrainFacts => ({
  ceoName: 'Mimoun',
  floors: [
    { floor: 1, name: 'keelfarm', open: 7, prs: 2, mergedToday: 3, agents: [{ name: 'Ada', status: 'working', doing: 'working on issue 12' }, { name: 'Bo', status: 'idle', doing: '' }] },
    { floor: 4, name: 'pixel-todo', open: 1, prs: 0, mergedToday: 0, agents: [{ name: 'Cy', status: 'testing', doing: 'testing pull request 9' }] },
  ],
  ceoJob: null,
  decisions: [
    { id: 'team:r1', kind: 'team', question: 'Hire a tester for floor 4?', options: ['Approve', 'Reject'] },
    { id: 'msg:7', kind: 'suggestion', question: 'Ship the login page today?', options: ['Yes, ship it', 'No, wait'] },
  ],
  it: [
    { label: 'Disk', level: 'warn', line: '7.9 GB free on the system disk' },
    { label: 'Memory', level: 'ok', line: '3 GB free' },
  ],
  ...patch,
});

describe('the Jarvis voice brain', () => {
  it('speaks as the CEO in the first person: never "asking Mimoun" or the CEO by name (msgs 4603/4605)', () => {
    const busy = facts({ ceoJob: 'reviewing floor 2' });
    const lines = ['Why did the login PR fail QA?', 'status please', 'File an issue to make the terminal font bigger', 'Anything waiting on me?', 'floor 1'].flatMap((q) => {
      const t = brainTurn(q, NO_BRAIN, busy);
      return [t.say, brainTurn('yes', t.state, busy).say];
    });
    for (const say of lines) {
      expect(say).not.toMatch(/asking Mimoun/i);
      expect(say).not.toMatch(/\bMimoun\b|\bthe CEO\b/);
    }
    expect(brainTurn('status', NO_BRAIN, busy).say).toMatch(/I'm reviewing floor 2\./);
  });

  it('takes a turn sent twice within a few seconds once (msgs 4593/4595)', () => {
    expect(repeatTurn(undefined, 'Why is QA slow?', 1000)).toBe(false);
    expect(repeatTurn({ text: 'Why is QA slow?', at: 1000 }, 'why is QA slow', 4000)).toBe(true);
    expect(repeatTurn({ text: 'Why is QA slow?', at: 1000 }, 'Why is QA slow?', 20_000)).toBe(false);
    expect(repeatTurn({ text: 'Why is QA slow?', at: 1000 }, 'And floor 4?', 2000)).toBe(false);
  });

  it('answers status, a floor, decisions and server health at once from company data, with no hand-off', () => {
    const status = brainTurn("How's everyone doing? Give me the status.", NO_BRAIN, facts());
    expect(status.act).toBeUndefined();
    expect(status.say).toMatch(/2 floors, 3 people, 2 working right now, 3 merges today/);
    expect(status.say).toMatch(/2 decisions waiting on you/);

    const floor = brainTurn("What's floor 4 doing?", NO_BRAIN, facts());
    expect(floor.act).toBeUndefined();
    expect(floor.say).toMatch(/^Floor 4, pixel-todo: 1 open issue, no pull requests/);
    expect(floor.say).toMatch(/Cy is testing pull request 9/);
    expect(brainTurn("what's the fourth floor up to", NO_BRAIN, facts()).say).toMatch(/^Floor 4/);
    expect(brainTurn('floor 9 please', NO_BRAIN, facts()).say).toMatch(/There's no floor 9. The floors are 1 and 4/);

    const asks = brainTurn('Anything waiting on me?', NO_BRAIN, facts());
    expect(asks.say).toMatch(/2 decisions waiting. The first: Hire a tester for floor 4\? Say approve or reject/);
    expect(asks.state.focus).toBe('team:r1');

    expect(brainTurn("How's the server's health?", NO_BRAIN, facts()).say).toMatch(/1 check needs a look. Disk: 7.9 GB free/);
    expect(brainTurn('how is the disk', NO_BRAIN, facts({ it: null })).say).toMatch(/hasn't run/);
  });

  it('hands a question to the CEO at once, with a spoken acknowledgement', () => {
    const t = brainTurn('Why did the login PR fail QA?', NO_BRAIN, facts({ ceoJob: 'reviewing floor 2' }));
    expect(t.act).toEqual({ kind: 'ceo', text: 'Why did the login PR fail QA?' });
    expect(t.handoff).toBe(true);
    expect(t.say).toBe("On it. I'll look into that now and tell you when I have it.");
  });

  it('asks "Should I…?" before a change and does it only on a spoken yes', () => {
    const ask = brainTurn('File an issue to make the terminal font bigger', NO_BRAIN, facts());
    expect(ask.act).toBeUndefined();
    expect(ask.say).toBe('Should I file an issue to make the terminal font bigger?');
    const yes = brainTurn('Yes please', ask.state, facts());
    expect(yes.act).toEqual({ kind: 'ceo', text: 'File an issue to make the terminal font bigger' });
    expect(yes.handoff).toBe(true);
    expect(yes.state.pending).toBeNull();
    const no = brainTurn('no, never mind', ask.state, facts());
    expect(no.act).toBeUndefined();
    expect(no.say).toBe("Okay, I won't.");
  });

  it('approves or rejects a decision by voice, confirming first', () => {
    const read = brainTurn('what decisions are open', NO_BRAIN, facts());
    const ask = brainTurn('approve it', read.state, facts());
    expect(ask.say).toBe('Should I approve "Hire a tester for floor 4?"?');
    expect(ask.act).toBeUndefined();
    expect(brainTurn('yes', ask.state, facts()).act).toEqual({ kind: 'decide', id: 'team:r1', option: 'Approve', approve: true });

    const second = brainTurn('approve the second one', NO_BRAIN, facts());
    expect(second.say).toMatch(/answer "Ship the login page today\?" with "Yes, ship it"/);
    expect(brainTurn('go ahead', second.state, facts()).act).toEqual({ kind: 'decide', id: 'msg:7', option: 'Yes, ship it' });
    const reject = brainTurn('reject the first', NO_BRAIN, facts());
    expect(brainTurn('yes', reject.state, facts()).act).toEqual({ kind: 'decide', id: 'team:r1', option: 'Reject', approve: false });
  });

  it("knows the end of a conversation and the client's markers", () => {
    expect(wantsToEnd("That's all, thanks")).toBe(true);
    expect(wantsToEnd('Bye!')).toBe(true);
    expect(wantsToEnd("what's all this about")).toBe(false);
    expect(brainTurn("that's all", NO_BRAIN, facts()).say).toBe('Okay. Talk soon.');
    expect(MARKER.exec(marker('msg', 12))?.slice(1)).toEqual(['msg', '12']);
    expect(markerSay('I filed #278.', true)).toBe("I filed number 278. The full answer's in the chat.");
    expect(markerSay('Done.', false)).toBe('Done.');
  });

  it("reads the manager's last turn from ElevenLabs' messages", () => {
    expect(lastUserText([{ role: 'system', content: 'x' }, { role: 'user', content: 'first' }, { role: 'assistant', content: 'a' }, { role: 'user', content: [{ type: 'text', text: 'second' }] }])).toBe('second');
    expect(lastUserText(null)).toBe('');
  });
});
