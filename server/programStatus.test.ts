import { describe, expect, it } from 'vitest';
import { parseProgramStatus, programStatusStep, statusReason } from './programStatus.ts';

const osc = (body: string, end = '\x1b\\') => `\x1b]7501;${body}${end}`;

describe('OSC 7501 stream', () => {
  it('handles every split, removes escapes, and preserves other terminal output', () => {
    const input = `before\x1b[32m${osc('state=blocked:app=codex:unknown=ignored:msg=TmVlZCBhbnN3ZXI=')}after`;
    for (let i = 0; i <= input.length; i++) {
      const a = parseProgramStatus(undefined, input.slice(0, i));
      const b = parseProgramStatus(a.state, input.slice(i));
      expect(a.text + b.text).toBe('before\x1b[32mafter');
      expect([...a.statuses, ...b.statuses]).toEqual([{ state: 'blocked', app: 'codex', msg: 'Need answer' }]);
    }
  });

  it('accepts BEL and several records per chunk, ignoring queries, child records and unknown states', () => {
    const r = parseProgramStatus(undefined, osc('?') + osc('state=working', '\x07') + osc('state=blocked:id=child') + osc('state=wat') + osc('state=clear'));
    expect(r.text).toBe('');
    expect(r.statuses).toEqual([{ state: 'working' }, { state: 'clear' }]);
  });

  it('drops overlong sequences across chunks, bounds memory and resumes after the terminator', () => {
    let r = parseProgramStatus(undefined, '\x1b]7501;state=blocked:msg=');
    for (let i = 0; i < 10; i++) {
      r = parseProgramStatus(r.state, 'é'.repeat(1000));
      expect(r.state.pending.length).toBeLessThanOrEqual(4096);
      expect(r.text).toBe('');
      expect(r.statuses).toEqual([]);
    }
    r = parseProgramStatus(r.state, '\x1b');
    r = parseProgramStatus(r.state, `\\visible${osc('state=idle')}`);
    expect(r.text).toBe('visible');
    expect(r.statuses).toEqual([{ state: 'idle' }]);
  });

  it('counts the entire sequence in bytes, including its terminator', () => {
    const body = 'state=blocked:x=';
    const input = osc(body + 'x'.repeat(4096 - Buffer.byteLength(osc(body))));
    expect(parseProgramStatus(undefined, input).statuses).toEqual([{ state: 'blocked' }]);
    expect(parseProgramStatus(undefined, input.replace('x=', 'xx=')).statuses).toEqual([]);
  });

  it('ignores malformed base64 and scrubs decoded messages before clipping', () => {
    expect(parseProgramStatus(undefined, osc('state=waiting:msg=%%%')).statuses).toEqual([{ state: 'waiting' }]);
    expect(statusReason({ state: 'blocked', msg: '\x1b[31mNeed secret-value\nanswer' }, ['secret-value'])).toBe('Need [redacted] answer');
  });
});

describe('hook precedence', () => {
  const signal = { state: 'blocked' as const, at: 20_000, msg: 'Need answer' };
  it('waits ten seconds for hooks, then raises the watchdog blocked step', () => {
    expect(programStatusStep(signal, 19_000, 28_999)).toEqual({ do: 'wait' });
    expect(programStatusStep(signal, 19_000, 29_000)).toEqual({ do: 'blocked', reason: 'Need answer' });
  });
  it('never lets an older or simultaneous OSC override a hook, even much later', () => {
    for (const hook of [20_000, 21_000]) expect(programStatusStep(signal, hook, 100_000)).toEqual({ do: 'wait' });
  });
  it('handles missing hooks and only waiting/blocked signals', () => {
    expect(programStatusStep(signal, 0, 20_000).do).toBe('blocked');
    expect(programStatusStep({ ...signal, state: 'waiting' }, 0, 20_000).do).toBe('blocked');
    for (const state of ['idle', 'working', 'done', 'clear'] as const) expect(programStatusStep({ ...signal, state }, 0, 20_000)).toEqual({ do: 'wait' });
    expect(programStatusStep(undefined, 0, 20_000)).toEqual({ do: 'wait' });
  });
});
