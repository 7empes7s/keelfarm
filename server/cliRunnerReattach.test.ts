import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Request, Response } from 'express';
import type { AgentTerminal } from './terminal.ts';
import type { SessionHandle } from './agentRunner.ts';
import type { OfficeTools } from './ceo.ts';
import type * as PtyClient from './ptyClient.ts';

// A QA session the terminal keeper held through an office restart (#333): once the office follows it again, its lab
// calls reach the new office's tools at the address it already has, instead of "This session has ended".

vi.mock('./ptyClient.ts', async (original) => ({
  ...(await original<typeof PtyClient>()),
  terminalsAvailable: true,
  startKeeper: async () => [{ id: 'p1', pid: 123, exit: null, meta: { agentId: 'qa1', cli: 'claude', token: 'kept-token', dir: '/tmp/kept-session', resumeId: 's1', busy: true } }],
  adoptPty: () => ({ pid: 123, write() {}, resize() {}, setMeta() {}, kill() {}, onData() {}, onExit() {} }),
}));
import { handleMcp, reconnectClis, startCliSession } from './cliRunner.ts';

let session: SessionHandle | undefined;
afterEach(() => {
  session?.stop();
  session = undefined;
});

/** handleMcp's answer when it has no tools, or 'served' when it reached the session's office tools. */
async function call(token: string): Promise<string> {
  let answer = '';
  const res = { status: (code: number) => ({ json: (b: { error: { message: string } }) => void (answer = `${code} ${b.error.message}`) }) } as unknown as Response;
  await handleMcp(token, {} as Request, res).catch((err: Error) => void (answer = err.message));
  return answer;
}

describe('a CLI kept through an office restart', () => {
  it('is told to call again until the office follows it, then reaches its office tools', async () => {
    const term = { write() {}, note() {}, bind() {}, screen: () => '', cols: 120, rows: 32 } as unknown as AgentTerminal;
    const back = await reconnectClis(() => term);
    expect(back).toEqual([{ agentId: 'qa1', cli: 'claude', resumeId: 's1', busy: true }]);
    expect(await call('kept-token')).toMatch(/^503 The office restarted and is picking this session up again/);
    const office = { serve: () => { throw new Error('served'); } } as unknown as OfficeTools;
    const cb = { log() {}, tool() {}, sessionId() {}, browserUrl() {}, screenshot() {}, finished() {} };
    session = startCliSession({ cwd: process.cwd(), prompt: '', systemAppend: '', model: '', effort: 'medium', browserTesting: false, additionalDirectories: [], role: 'agent', terminal: term, reattach: true, office }, cb);
    expect(await call('kept-token')).toBe('served');
    expect(await call('unknown')).toBe('404 This session has ended.');
  });
});
