import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AgentTerminal } from './terminal.ts';
import type { SessionHandle } from './agentRunner.ts';
import type * as Clis from './clis.ts';
import type * as PtyClient from './ptyClient.ts';

const fake = vi.hoisted(() => ({ data: (() => {}) as (data: string) => void, token: '' }));
vi.mock('./clis.ts', async (original) => ({ ...await original<typeof Clis>(), commandFor: () => ({ file: process.execPath, args: [] }) }));
vi.mock('./ptyClient.ts', async (original) => ({
  ...await original<typeof PtyClient>(),
  terminalsAvailable: true,
  spawnPty: (_file: string, _args: string[], _opts: unknown, meta: { token: string }) => {
    fake.token = meta.token;
    const exits: ((code: number) => void)[] = [];
    return { pid: 123, write() {}, resize() {}, setMeta() {}, kill: () => exits.forEach((fn) => fn(0)), onData: (fn: (data: string) => void) => { fake.data = fn; }, onExit: (fn: (code: number) => void) => exits.push(fn) };
  },
}));
import { handleHook, startCliSession } from './cliRunner.ts';

let session: SessionHandle | undefined;
afterEach(() => { session?.stop(); session = undefined; vi.useRealTimers(); });

function start() {
  vi.useFakeTimers();
  const term = { write: vi.fn(), note() {}, bind() {}, screen: () => '', tail: () => [], cols: 120, rows: 32 } as unknown as AgentTerminal;
  const cb = { blocked: vi.fn(), log: vi.fn(), tool: vi.fn(), sessionId: vi.fn(), browserUrl: vi.fn(), screenshot: vi.fn(), finished: vi.fn() };
  session = startCliSession({ cwd: process.cwd(), prompt: 'test', systemAppend: '', model: '', effort: 'medium', browserTesting: false, additionalDirectories: [], role: 'agent', cli: 'codex', terminal: term, env: { TEST_SECRET: 'private-status-value' } }, cb);
  return { term, cb };
}

describe('terminal status backup wiring', () => {
  it('strips split output before the terminal, reports scrubbed blocked text, and clears it on a hook', () => {
    const { term, cb } = start();
    vi.advanceTimersByTime(1000);
    fake.data('hello\x1b]750');
    fake.data(`1;state=blocked:msg=${Buffer.from('Need private-status-value').toString('base64')}\x1b\\world`);
    expect(vi.mocked(term.write).mock.calls.map(([s]) => s).join('')).toBe('helloworld');
    vi.advanceTimersByTime(7000);
    expect(cb.blocked).not.toHaveBeenCalled();
    vi.advanceTimersByTime(2000);
    expect(cb.blocked).toHaveBeenLastCalledWith('Need [redacted]');
    handleHook(fake.token, { hook_event_name: 'PreToolUse', tool_name: 'Read' });
    expect(cb.blocked).toHaveBeenLastCalledWith(null);
    vi.advanceTimersByTime(20_000);
    expect(cb.blocked).toHaveBeenCalledTimes(2);
  });

  it('clears an OSC block on a working record and never overrides a newer hook', () => {
    const { cb } = start();
    vi.advanceTimersByTime(1000);
    fake.data('\x1b]7501;state=waiting\x07');
    vi.advanceTimersByTime(9000);
    expect(cb.blocked).toHaveBeenCalledOnce();
    fake.data('\x1b]7501;state=working\x07');
    vi.advanceTimersByTime(2000);
    expect(cb.blocked).toHaveBeenLastCalledWith(null);
    fake.data('\x1b]7501;state=blocked\x07');
    vi.advanceTimersByTime(1000);
    handleHook(fake.token, { hook_event_name: 'StatusLine' });
    vi.advanceTimersByTime(20_000);
    expect(cb.blocked).toHaveBeenCalledTimes(2);
  });
});
