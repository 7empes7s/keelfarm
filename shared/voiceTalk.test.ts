import { describe, expect, it } from 'vitest';
import type { LiveStep } from './ceoStream.ts';
import { stepWords } from './ceoSteps.ts';
import { ACK_GAP_MS, ACKS, lineMicOpen, milestoneLine, pickAck, progressCue, sayNow, spokenStep, talkMode, talkStart, TALK_PACE } from './voiceTalk.ts';

const T0 = 1_000_000;
const running = (label: string, icon = '📖'): LiveStep => ({ label, icon, state: 'running', at: T0 });
/** Nothing a voice should read out: issue or PR numbers, digits, paths, markdown. */
const CLEAN = /^[^\d#/\\`*_[\]<>{}|~]+$/;

describe('pickAck', () => {
  it('picks a varied ack from the fixed list', () => {
    const said = new Set([0, 1, 2, 3].map((n) => pickAck(-Infinity, T0, n)));
    expect(said.size).toBe(4);
    for (const a of said) expect(ACKS).toContain(a);
  });

  it('never says two acks within the gap', () => {
    expect(pickAck(T0, T0 + ACK_GAP_MS - 1, 1)).toBeNull();
    expect(pickAck(T0, T0 + ACK_GAP_MS, 1)).toBe(ACKS[1]);
  });

  it('never pretends to answer, and has nothing a voice would read badly', () => {
    for (const a of ACKS) {
      expect(a).toMatch(CLEAN);
      expect(a.split(' ').length).toBeLessThanOrEqual(7);
    }
  });
});

describe('spokenStep', () => {
  it('drops numbers, paths, quotes and links from the step log', () => {
    const cases: [string, string][] = [
      ["Reading PR #122's changes on floor 3", "reading a pull request's changes"],
      ['Closing #12 on floor 2', 'closing an issue'],
      ['Waiting for PR #138 to merge on floor 3 (up to 10 min)', 'waiting for a pull request to merge'],
      ['Reading client/src/pocket/touch/joystickThumbZone.tsx', 'reading a file'],
      ['Reading package.json', 'reading a file'],
      ['Filing an issue on floor 1: “A bigger thumb zone”', 'filing an issue'],
      ['Searching the web: mobile joystick UX', 'searching the web'],
      ['Running npm run build -- --port 5644', 'running a command'],
      ["Updating floor 4's profile", "updating the floor's profile"],
      ['Reading example.com', 'reading a file'],
    ];
    for (const [label, said] of cases) expect(spokenStep(label)).toBe(said);
  });

  it('says every step of the log cleanly', () => {
    const lines = [
      stepWords('mcp__office__pr_diff', '⏺ 🔀 pr_diff PR #12 → floor 3'),
      stepWords('mcp__office__wait_for', '⏺ wait_for pr_qa floor 3 PR #138 · up to 10 min'),
      stepWords('Read', '⏺ Read server/ceo.ts'),
      stepWords('Grep', '⏺ Grep "joystick"'),
      stepWords('WebFetch', '⏺ Fetch https://example.com/joystick-study'),
      stepWords('Bash', '$ npm test -- --maxWorkers=2'),
      stepWords('mcp__office__file_issue', '⏺ file_issue floor 3 "Add **bold** `code`"'),
    ];
    for (const w of lines) expect(spokenStep(w.text)).toMatch(CLEAN);
  });

  it('falls back to a plain phrase when nothing clean is left', () => {
    expect(spokenStep('Using v2_beta')).toBe('working through it');
  });
});

describe('progressCue: the server paces progress', () => {
  it('waits a full window from the job start for the first regular line, then one per window', () => {
    const t = talkStart(T0);
    const step = running("Reading PR #9's changes on floor 1");
    expect(progressCue(t, step, 1, T0 + TALK_PACE.regularMs - 1)).toBeNull();
    const first = progressCue(t, step, 1, T0 + TALK_PACE.regularMs)!;
    expect(first).toMatchObject({ milestone: false });
    expect(first.text).toMatch(CLEAN);
    expect(first.text).toContain("reading a pull request's changes");
    expect(progressCue(first.state, step, 2, T0 + TALK_PACE.regularMs + 1000)).toBeNull();
    expect(progressCue(first.state, step, 2, T0 + 2 * TALK_PACE.regularMs)).not.toBeNull();
  });

  it('says a milestone at once, once per step, and not twice within its gap', () => {
    const t = talkStart(T0);
    const filed: LiveStep = { label: 'Filed floor 3 #149', icon: '📝', state: 'done' };
    const m = progressCue(t, filed, 4, T0 + 1000)!;
    expect(m).toMatchObject({ text: 'Filed that issue.', milestone: true });
    expect(progressCue(m.state, filed, 4, T0 + 60_000)?.milestone).not.toBe(true); // the same step again
    const qa = running("Waiting for QA's verdict on PR #3 on floor 1", '⏳');
    expect(progressCue(m.state, qa, 5, T0 + 1000 + TALK_PACE.milestoneMs - 1)).toBeNull();
    expect(progressCue(m.state, qa, 5, T0 + 1000 + TALK_PACE.milestoneMs)).toMatchObject({ text: 'Waiting on QA now.', milestone: true });
  });

  it('knows the milestones: filed, waiting on QA or a merge, sent back', () => {
    expect(milestoneLine({ label: 'Filing an issue on floor 1', icon: '📝', state: 'running' })).toBeNull(); // not filed yet
    expect(milestoneLine({ label: 'Waiting for PR #3 to merge on floor 1', icon: '⏳', state: 'running' })).toBe('Waiting for the merge.');
    expect(milestoneLine({ label: 'Sending PR #3 back for a fix on floor 1', icon: '↩️', state: 'running' })).toBe('Sending it back for a fix.');
    expect(milestoneLine({ label: 'Answering a message', icon: '↩️', state: 'running' })).toBeNull();
    expect(milestoneLine({ label: 'Reading a file', icon: '📖', state: 'running' })).toBeNull();
  });

  it('says nothing of a finished ordinary step', () => {
    expect(progressCue(talkStart(T0), { label: 'Reading a file', icon: '📖', state: 'done' }, 1, T0 + 10 * TALK_PACE.regularMs)).toBeNull();
  });
});

describe('sayNow and talkMode: each tab decides', () => {
  const quiet = { micOpen: false, speaking: false };
  const regular = { kind: 'progress' as const, milestone: false };
  const milestone = { kind: 'progress' as const, milestone: true };

  it('says progress as the setting allows', () => {
    expect(sayNow(regular, 'off', quiet)).toBe(false);
    expect(sayNow(milestone, 'off', quiet)).toBe(false);
    expect(sayNow(regular, 'milestones', quiet)).toBe(false);
    expect(sayNow(milestone, 'milestones', quiet)).toBe(true);
    expect(sayNow(regular, 'regular', quiet)).toBe(true);
    expect(sayNow({ kind: 'ack' }, 'off', quiet)).toBe(true);
  });

  it('stays silent while the mic is open or speech is playing', () => {
    for (const line of [{ kind: 'ack' as const }, regular, milestone]) {
      expect(sayNow(line, 'regular', { micOpen: true, speaking: false })).toBe(false);
      expect(sayNow(line, 'regular', { micOpen: false, speaking: true })).toBe(false);
    }
  });

  it('blocks call updates during manager speech and transcription, but allows quiet listening', () => {
    expect(lineMicOpen(true, 'listening', false)).toBe(false);
    expect(lineMicOpen(true, 'listening', true)).toBe(true);
    expect(lineMicOpen(true, 'transcribing', false)).toBe(true);
    expect(lineMicOpen(false, 'listening', false)).toBe(true);
    expect(lineMicOpen(false, 'idle', false)).toBe(false);
  });

  it('is off by default outside a call, milestones in one', () => {
    expect(talkMode('off', false)).toBe('off');
    expect(talkMode('off', true)).toBe('milestones');
    expect(talkMode('regular', true)).toBe('regular');
    expect(talkMode('milestones', false)).toBe('milestones');
  });
});
