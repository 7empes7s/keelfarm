import { describe, expect, it } from 'vitest';
import { agentLine, freshLine, lineVoice, LINE_COOLDOWN_MS, LINE_MAX_WORDS, lineSituation, lineText, MERGE_NEWS_MS, nextLine, shortTitle, spokenLine, variants, type LineFacts, type LineSituation } from './agentLines.ts';

const NOW = 1_800_000_000_000;
const facts = (over: Partial<LineFacts> = {}): LineFacts => ({
  status: 'idle',
  task: null,
  issueNumber: null,
  issueTitle: null,
  prNumber: null,
  lastMerge: null,
  author: '',
  memoryWait: false,
  hour: 14,
  now: NOW,
  ...over,
});

describe('lineSituation', () => {
  it('says what they work on', () => {
    expect(lineSituation(facts({ status: 'working', task: 'issue', issueNumber: 301, issueTitle: 'Lighter QA browser' }))).toEqual({ kind: 'building', issue: 301, title: 'Lighter QA browser' });
    expect(lineSituation(facts({ status: 'working', task: 'qa', prNumber: 175, author: 'Grace' }))).toEqual({ kind: 'testing', pr: 175, author: 'Grace' });
    expect(lineSituation(facts({ status: 'working', task: 'fix', prNumber: 175 }))).toEqual({ kind: 'fixing', pr: 175 });
    expect(lineSituation(facts({ status: 'preparing', task: 'issue', issueNumber: 9 }))).toEqual({ kind: 'preparing', issue: 9 });
  });

  it('is free, or waiting for memory when work is held', () => {
    expect(lineSituation(facts()).kind).toBe('free');
    expect(lineSituation(facts({ status: 'done' })).kind).toBe('free');
    expect(lineSituation(facts({ memoryWait: true })).kind).toBe('memory');
  });

  it('puts needing the manager first, by the needs-you rule, then errors', () => {
    expect(lineSituation(facts({ status: 'working', task: 'issue', blocked: 'a prompt', hour: 2 }))).toEqual({ kind: 'stuck', why: 'prompt' });
    expect(lineSituation(facts({ needsSignIn: true }))).toEqual({ kind: 'stuck', why: 'sign-in' });
    expect(lineSituation(facts({ waiting: 'manager' }))).toEqual({ kind: 'stuck', why: 'question' });
    expect(lineSituation(facts({ status: 'error' }))).toEqual({ kind: 'stuck', why: 'error' });
  });

  it('is sleepy late at night, still naming the work', () => {
    expect(lineSituation(facts({ hour: 23 }))).toEqual({ kind: 'night', issue: null });
    expect(lineSituation(facts({ hour: 3, status: 'working', task: 'issue', issueNumber: 12 }))).toEqual({ kind: 'night', issue: 12 });
    expect(lineSituation(facts({ hour: 5 })).kind).toBe('free');
  });

  it('cheers a fresh merge, not an old one', () => {
    expect(lineSituation(facts({ lastMerge: { pr: 88, at: NOW - 60_000 } }))).toEqual({ kind: 'merged', pr: 88 });
    expect(lineSituation(facts({ lastMerge: { pr: 88, at: NOW - MERGE_NEWS_MS - 1 } })).kind).toBe('free');
  });
});

describe('agentLine', () => {
  const all: LineSituation[] = [
    { kind: 'stuck', why: 'sign-in' },
    { kind: 'stuck', why: 'error' },
    { kind: 'merged', pr: 1234 },
    { kind: 'night', issue: 1234 },
    { kind: 'building', issue: 1234, title: shortTitle('Agents talk like people when clicked') },
    { kind: 'preparing', issue: 1234 },
    { kind: 'testing', pr: 1234, author: 'Grace' },
    { kind: 'fixing', pr: 1234 },
    { kind: 'memory' },
    { kind: 'free' },
    { kind: 'ceo', busy: 12, free: 3, needs: 2, merged: 7 },
  ];

  it('fills in the facts', () => {
    expect(agentLine({ kind: 'building', issue: 301, title: 'lighter QA browser' }, 0)).toBe("I'm on #301, lighter QA browser. Going well!");
    expect(agentLine({ kind: 'testing', pr: 175, author: 'Grace' }, 0)).toBe("Checking Grace's PR #175, one sec.");
    expect(lineText(agentLine({ kind: 'stuck', why: 'sign-in' }, 0))).toBe("I'm stuck on the sign-in step. Can you look?");
    expect(agentLine({ kind: 'night', issue: null }, 0)).toBe('[yawns] I need sleep.');
  });

  it('keeps every variant short and free of raw ids', () => {
    for (const s of all)
      for (let turn = 0; turn < variants(s.kind); turn++) {
        const text = lineText(agentLine(s, turn, 'agent-7'));
        expect(text.split(/\s+/).length, text).toBeLessThanOrEqual(LINE_MAX_WORDS);
        expect(text).not.toMatch(/agent-|undefined|null|\[/);
      }
  });

  it('takes the variants in turn, starting at a place seeded by the agent', () => {
    const s: LineSituation = { kind: 'free' };
    const seen = new Set([0, 1, 2].map((t) => agentLine(s, t, 'ada')));
    expect(seen.size).toBe(variants('free'));
    expect(agentLine(s, 3, 'ada')).toBe(agentLine(s, 0, 'ada'));
    expect(['ada', 'bob', 'cy', 'dee'].map((id) => agentLine(s, 0, id)).some((l) => l !== agentLine(s, 0, 'ada'))).toBe(true);
  });
});

describe('audio tags', () => {
  const line = "[laughs] PR #9 merged, let's go!";
  it('go to v4 models only', () => {
    expect(spokenLine(line, 'eleven_v4')).toBe(line);
    expect(spokenLine(line, 'eleven_v4_turbo')).toBe(line);
    expect(spokenLine(line, 'eleven_flash_v2_5')).toBe("PR #9 merged, let's go!");
    expect(spokenLine(line, 'eleven_multilingual_v2')).toBe("PR #9 merged, let's go!");
  });
  it('never show or reach the browser voice', () => expect(lineText('[sighs] Stuck. [whispers] help')).toBe('Stuck. help'));
});

describe('the per-agent cooldown', () => {
  const s: LineSituation = { kind: 'free' };
  it('repeats the last line inside 20 s, then moves on', () => {
    const first = nextLine(undefined, NOW, s, 'ada');
    expect(first.turn).toBe(0);
    expect(nextLine(first, NOW + LINE_COOLDOWN_MS - 1, { kind: 'merged', pr: 1 }, 'ada')).toBe(first);
    expect(freshLine(first, NOW + LINE_COOLDOWN_MS - 1)).toBe(false);
    const second = nextLine(first, NOW + LINE_COOLDOWN_MS, s, 'ada');
    expect(second.turn).toBe(1);
    expect(second.line).not.toBe(first.line);
    expect(second.at).toBe(NOW + LINE_COOLDOWN_MS);
  });
});

describe('shortTitle', () => {
  it('keeps a few plain words', () => {
    expect(shortTitle('Lighter QA browser for tests')).toBe('lighter QA browser');
    expect(shortTitle('QA: run the browser lighter (#301)')).toBe('run the browser lighter');
    expect(shortTitle('[bug] Fix the login!')).toBe('fix the login');
    expect(shortTitle('!!!')).toBe('');
  });
});

describe('lineVoice', () => {
  const on = { agentsSpeak: true, provider: 'elevenlabs' as const, keySet: true, demo: false, muted: false, replaying: false, reading: false };
  it('is ElevenLabs with its provider on and a key', () => expect(lineVoice(on)).toBe('elevenlabs'));
  it('babbles as before without a key, another provider, the setting, or while muted, replaying or reading aloud', () => {
    for (const off of [{ keySet: false }, { provider: 'browser' as const }, { provider: 'off' as const }, { agentsSpeak: false }, { muted: true }, { replaying: true }, { reading: true }]) expect(lineVoice({ ...on, ...off })).toBeNull();
  });
  it("is the browser's voice in the demo without a key", () => {
    expect(lineVoice({ ...on, demo: true, keySet: false })).toBe('browser');
    expect(lineVoice({ ...on, demo: true, provider: 'off' })).toBe('browser');
    expect(lineVoice({ ...on, demo: true, agentsSpeak: false })).toBeNull();
  });
});
