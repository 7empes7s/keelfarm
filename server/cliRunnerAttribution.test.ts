import fs from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AgentTerminal } from './terminal.ts';
import type { SessionHandle } from './agentRunner.ts';
import type { AgentCli } from '../shared/types.ts';
import type * as Clis from './clis.ts';
import type * as PtyClient from './ptyClient.ts';

// #599: every session's CLI is launched with commit and PR attribution off.
const fake = vi.hoisted(() => ({ args: [] as string[] }));
vi.mock('./clis.ts', async (original) => ({ ...await original<typeof Clis>(), commandFor: () => ({ file: process.execPath, args: [] }) }));
vi.mock('./ptyClient.ts', async (original) => ({
  ...await original<typeof PtyClient>(),
  terminalsAvailable: true,
  spawnPty: (_file: string, args: string[]) => {
    fake.args = args;
    return { pid: 123, write() {}, resize() {}, setMeta() {}, kill() {}, onData() {}, onExit() {} };
  },
}));
import { startCliSession } from './cliRunner.ts';

let session: SessionHandle | undefined;
afterEach(() => { session?.stop(); session = undefined; });

function launch(cli: AgentCli, role: 'agent' | 'ceo' = 'agent') {
  const term = { write() {}, note() {}, bind() {}, screen: () => '', tail: () => [], cols: 120, rows: 32 } as unknown as AgentTerminal;
  const cb = { blocked() {}, log() {}, tool() {}, sessionId() {}, browserUrl() {}, screenshot() {}, finished() {} };
  session = startCliSession({ cwd: process.cwd(), prompt: 'test', systemAppend: '', model: '', effort: 'medium', browserTesting: false, additionalDirectories: [], role, cli, terminal: term }, cb);
  return fake.args;
}

describe('no AI attribution in agents\' commits and PRs (#599)', () => {
  it.each(['agent', 'ceo'] as const)('a Claude Code session (%s) gets settings with attribution off', (role) => {
    const args = launch('claude', role);
    const settings = JSON.parse(fs.readFileSync(args[args.indexOf('--settings') + 1], 'utf8'));
    expect(settings.attribution).toEqual({ commit: '', pr: '', sessionUrl: false });
    expect(settings.includeCoAuthoredBy).toBe(false);
    expect(settings.hooks).toBeDefined(); // still the office's own settings file
  });

  it('a Codex session turns its commit attribution off', () => {
    const args = launch('codex');
    expect(args[args.indexOf('commit_attribution=""') - 1]).toBe('-c');
  });
});
