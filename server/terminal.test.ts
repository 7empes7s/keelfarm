import { EventEmitter } from 'node:events';
import type { WebSocket } from 'ws';
import type { TermServerMessage } from '../shared/types.ts';
import { describe, expect, it, vi } from 'vitest';
import { AgentTerminal } from './terminal.ts';

describe('AgentTerminal', () => {
  it('keeps what was printed, so a late viewer sees the same screen', async () => {
    const t = new AgentTerminal();
    t.write('\x1b[32mhello\x1b[0m world\r\n');
    await t.flush();
    expect(t.screen()).toContain('hello world');
    const again = new AgentTerminal();
    again.write(t.snapshot());
    await again.flush();
    expect(again.screen()).toContain('hello world');
    t.dispose();
    again.dispose();
  });

  it('sends keystrokes and sizes to the running CLI, within sane bounds', () => {
    const t = new AgentTerminal();
    const got: string[] = [];
    t.bind({ write: (d) => got.push(d), resize: (c, r) => got.push(`${c}x${r}`) });
    expect(got).toEqual([`${t.cols}x${t.rows}`]);
    t.resize(5000, 1);
    expect([t.cols, t.rows]).toEqual([400, 5]);
    expect(got.at(-1)).toBe('400x5');
    t.bind(null);
    expect(t.live).toBe(false);
    t.dispose();
  });
});

// The viewer socket is local; the real AgentTerminal routes input into a recording fake PTY.
function viewer() {
  const socket = Object.assign(new EventEmitter(), { OPEN: 1, readyState: 1, bufferedAmount: 0, send: vi.fn(), close: vi.fn() });
  return { socket, ws: socket as unknown as WebSocket, messages: () => socket.send.mock.calls.map(([json]) => JSON.parse(json) as TermServerMessage) };
}

it('reports dropped input only to its sender and preserves the input watcher', async () => {
  const term = new AgentTerminal();
  const first = viewer();
  const other = viewer();
  term.attach(first.ws);
  term.attach(other.ws);
  await term.flush();
  term.onInput = vi.fn();
  first.socket.emit('message', JSON.stringify({ t: 'input', data: 'private text' }));
  expect(first.messages().filter((m) => m.t === 'dropped')).toEqual([{ t: 'dropped' }]);
  expect(other.messages().some((m) => m.t === 'dropped')).toBe(false);
  expect(term.onInput).toHaveBeenCalledWith('private text');
  expect(term.screen()).not.toContain('private text');
  term.dispose();
});

it('forwards exact bytes while bound and reports input dropped after unbinding', async () => {
  const term = new AgentTerminal();
  const v = viewer();
  const writes: string[] = [];
  term.attach(v.ws);
  await term.flush();
  term.bind({ write: (data) => writes.push(data), resize: () => undefined });
  for (const data of ['hello', '\x1b', '\r', '\x1b[A', '\x03', '\x01', 'paste']) v.socket.emit('message', JSON.stringify({ t: 'input', data }));
  expect(writes).toEqual(['hello', '\x1b', '\r', '\x1b[A', '\x03', '\x01', 'paste']);
  expect(v.messages().some((m) => m.t === 'dropped')).toBe(false);
  term.bind(null);
  v.socket.emit('message', JSON.stringify({ t: 'input', data: 'late' }));
  expect(writes).not.toContain('late');
  expect(v.messages().at(-1)).toEqual({ t: 'dropped' });
  term.dispose();
});
