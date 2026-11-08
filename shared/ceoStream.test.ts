import { describe, expect, it } from 'vitest';
import { currentStep, finishedLog, foldStream, liveText, MAX_STEPS, stopReply, type CeoLive, type StreamEvent } from './ceoStream.ts';

const fold = (events: StreamEvent[], start: CeoLive | null = null, t0 = 1) => events.reduce<CeoLive | null>((l, e, i) => foldStream(l, e, t0 + i * 1000), start)!;
const tool = (name: string, text = `⏺ ${name}`): StreamEvent => ({ kind: 'log', entry: { kind: 'tool', tool: name, text } });
const result = (text: string): StreamEvent => ({ kind: 'log', entry: { kind: 'result', text: `  ⎿ ${text}` } });

describe('the live reply (stream assembly)', () => {
  it('grows a partial text block in place, and starts a new one after it is done', () => {
    const l = fold([
      { kind: 'text', text: 'Let me', done: false },
      { kind: 'text', text: 'Let me check the floors.', done: true },
      { kind: 'text', text: 'All green.', done: false },
    ]);
    expect(l.blocks).toEqual(['Let me check the floors.', 'All green.']);
    expect(l.open).toBe(true);
    expect(liveText(l)).toBe('Let me check the floors.\n\nAll green.');
  });

  it('turns tool calls into timed steps in plain words: running until their result, then done or failed with it', () => {
    let l = fold([tool('mcp__office__company_status'), result('3 floors')]);
    expect(l.steps).toEqual([{ label: 'Checking the floors', icon: '🏢', state: 'done', at: 1, ms: 1000, note: '3 floors' }]);
    l = fold([tool('WebSearch', '⏺ Search "mobile joystick UX"'), { kind: 'log', entry: { kind: 'error', text: '  ⎿ timed out' } }], l, 5000);
    expect(l.steps[1]).toEqual({ label: 'Searching the web: mobile joystick UX', icon: '🌐', state: 'failed', at: 5000, ms: 1000, note: 'timed out' });
    l = fold([tool('mcp__office__file_issue', '⏺ 📝 file_issue "Dark mode" → floor 3'), result('Filed #47 on floor 3: Dark mode.')], l);
    expect(l.steps[2]).toMatchObject({ label: 'Filed floor 3 #47', state: 'done' });
    expect(l.stepCount).toBe(3);
  });

  it('closes a step whose result never came when the next one starts, timing it, and ignores other lines', () => {
    const l = fold([tool('Read', '⏺ Read ceo/NOTES.md'), { kind: 'log', entry: { kind: 'thinking', text: '✻' } }, tool('Grep', '⏺ Grep "useTodos"')]);
    expect(l.steps).toEqual([
      { label: 'Reading its notes', icon: '📖', state: 'done', at: 1, ms: 2000 },
      { label: 'Searching the code for “useTodos”', icon: '🔎', state: 'running', at: 2001 },
    ]);
    expect(currentStep(l)).toMatchObject({ label: 'Searching the code for “useTodos”', state: 'running' });
  });

  it('masks secrets in what a step shows', () => {
    const l = fold([tool('Bash', '⏺ $ GH_TOKEN=ghp_abcdefghijklmnopqrstuvwx gh pr list'), result('token ghp_abcdefghijklmnopqrstuvwx ok')]);
    expect(JSON.stringify(l.steps)).not.toContain('ghp_abcdefghijklmnop');
  });

  it('keeps the latest 50 steps only, counting them all', () => {
    expect(MAX_STEPS).toBe(50);
    const l = fold(Array.from({ length: MAX_STEPS + 5 }, () => tool('Bash')));
    expect(l.steps).toHaveLength(MAX_STEPS);
    expect(l.stepCount).toBe(MAX_STEPS + 5);
  });

  it('keeps the finished log for the reply: every step ended and timed, the count and how long the round took', () => {
    const l = fold([tool('WebFetch', '⏺ Fetch https://example.com/a'), { kind: 'log', entry: { kind: 'error', text: '  ⎿ 404' } }, tool('mcp__office__scale_team')]);
    const log = finishedLog(l, 10_001)!;
    expect(log.count).toBe(2);
    expect(log.ms).toBe(10_000);
    expect(log.steps.map((s) => [s.label, s.state, s.ms])).toEqual([
      ['Reading example.com', 'failed', 1000],
      ["Sizing a team", 'done', 8000],
    ]);
    expect(log.steps.every((s) => s.at === undefined)).toBe(true); // what the log doesn't show stays off every reply
    expect(log.steps.map((s) => s.note)).toEqual(['404', undefined]);
    expect(finishedLog(null, 1)).toBeNull();
  });
});

describe('a stopped job (stop semantics)', () => {
  it('says what its acting tool calls did, leaving out reads', () => {
    const text = stopReply([
      { tool: 'company_status', ok: true, out: '{"floors":[]}' },
      { tool: 'file_issue', ok: true, out: 'Filed #47 on floor 1: Dark mode.' },
      { tool: 'scale_team', ok: false, out: 'At most 10 agents' },
    ]);
    expect(text).toMatch(/^■ Stopped\./);
    expect(text).toContain('- Filed #47 on floor 1: Dark mode');
    expect(text).not.toContain('floors');
    expect(text).toContain('1 call was refused, so it changed nothing.');
  });

  it('says nothing changed, or what is still finishing', () => {
    expect(stopReply([{ tool: 'company_status', ok: true, out: '{}' }])).toBe('■ Stopped.\n\nNothing was changed.');
    expect(stopReply([{ tool: 'file_issue', ok: false, out: null }])).toContain('Still finishing: filing an issue.');
  });
});
