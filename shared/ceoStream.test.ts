import { describe, expect, it } from 'vitest';
import { currentStep, finishedSteps, foldStream, liveText, MAX_STEPS, stepLabel, stopReply, type CeoLive, type StreamEvent } from './ceoStream.ts';

const fold = (events: StreamEvent[], start: CeoLive | null = null) => events.reduce<CeoLive | null>((l, e) => foldStream(l, e, 1), start)!;
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

  it('turns tool calls into steps: running until their result, then done or failed', () => {
    let l = fold([tool('mcp__office__company_status'), result('3 floors')]);
    expect(l.steps).toEqual([{ label: 'Reading company status', state: 'done' }]);
    l = fold([tool('WebSearch'), { kind: 'log', entry: { kind: 'error', text: '  ⎿ timed out' } }], l);
    expect(l.steps[1]).toEqual({ label: 'Searching the web', state: 'failed' });
    l = fold([tool('mcp__office__file_issue'), result('Filed #47 on floor 1: Dark mode.')], l);
    expect(l.steps[2]).toEqual({ label: 'Filing #47', state: 'done' });
    expect(l.stepCount).toBe(3);
  });

  it('closes a step whose result never came when the next one starts, and ignores other lines', () => {
    const l = fold([tool('Read', '⏺ Read ceo/NOTES.md'), { kind: 'log', entry: { kind: 'thinking', text: '✻' } }, tool('Grep')]);
    expect(l.steps).toEqual([
      { label: 'Reading its notes', state: 'done' },
      { label: 'Searching files', state: 'running' },
    ]);
    expect(currentStep(l)).toEqual({ label: 'Searching files', state: 'running' });
  });

  it('keeps the latest steps only, counting them all', () => {
    const l = fold(Array.from({ length: MAX_STEPS + 5 }, () => tool('Bash')));
    expect(l.steps).toHaveLength(MAX_STEPS);
    expect(l.stepCount).toBe(MAX_STEPS + 5);
  });

  it('keeps the finished steps for the reply, a failed one marked', () => {
    expect(finishedSteps(fold([tool('WebFetch'), { kind: 'log', entry: { kind: 'error', text: '  ⎿ 404' } }, tool('mcp__office__scale_team'), result('ok')]))).toEqual(['✗ Reading a web page', 'Sizing a team']);
    expect(finishedSteps(null)).toEqual([]);
  });
});

describe('step labels', () => {
  it('says what a tool does in a few words', () => {
    expect(stepLabel('mcp__office__company_status')).toBe('Reading company status');
    expect(stepLabel('mcp__office__some_new_tool')).toBe('Some new tool');
    expect(stepLabel('Edit', '⏺ Update(ceo/NOTES.md)')).toBe('Updating its notes');
    expect(stepLabel('Write', '⏺ Write(plan.md)')).toBe('Writing a file');
    expect(stepLabel('mcp__claude_ai_Notion__notion-search')).toBe('Using Notion');
    expect(stepLabel('Mystery')).toBe('Using Mystery');
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
