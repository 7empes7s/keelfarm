import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { CliSetup, cliBinDir, cliPackage, npmInstall, npmInstallArgs } from './cliInstall.ts';
import { resolveCommand } from './clis.ts';
import { logTail, opencodeProviders } from '../shared/cliInstall.ts';
import type { AgentCli, CliView } from '../shared/types.ts';

const view = (installed: Set<AgentCli>): CliView[] =>
  (['claude', 'codex', 'gemini', 'opencode'] as AgentCli[]).map((id) => ({ id, label: id, installed: installed.has(id), version: installed.has(id) ? '1.0.0' : null, integrated: id === 'claude' }));

function setup(o: { install?: (id: AgentCli, here: Set<AgentCli>) => Promise<{ ok: boolean; tail: string[] }> } = {}) {
  const here = new Set<AgentCli>(['claude', 'codex']);
  const sent: CliView[][] = [];
  const s = new CliSetup({
    detect: async () => view(here),
    install: (id) => (o.install ? o.install(id, here) : (here.add(id), Promise.resolve({ ok: true, tail: [] }))),
    signIn: () => ({ stop: () => undefined }),
    changed: (clis) => sent.push(clis),
  });
  const gemini = () => sent.at(-1)!.find((c) => c.id === 'gemini')!;
  return { s, sent, gemini };
}

describe('CliSetup', () => {
  it('an install looks for the CLIs again, so the card turns installed without a restart', async () => {
    const { s, sent, gemini } = setup();
    await s.check();
    expect(gemini().installed).toBe(false);
    const run = s.install('gemini');
    expect(gemini().install).toMatchObject({ running: true, note: 'Installing @google/gemini-cli@0.68.0…' });
    await expect(run).resolves.toMatchObject({ running: false, ok: true });
    expect(gemini()).toMatchObject({ installed: true, version: '1.0.0', install: { ok: true } });
    expect(sent.length).toBeGreaterThanOrEqual(3);
  });

  it('a failed install keeps "not installed" with the log’s tail', async () => {
    const { s, gemini } = setup({ install: async () => ({ ok: false, tail: ['npm error code E404', 'npm error 404 Not Found'] }) });
    await s.check();
    await s.install('gemini');
    expect(gemini()).toMatchObject({ installed: false, install: { running: false, ok: false, note: 'Installing Gemini CLI failed.', tail: ['npm error code E404', 'npm error 404 Not Found'] } });
  });

  it('never runs two installs at once, nor one for a CLI already here', async () => {
    let finish = () => undefined as void;
    const { s } = setup({ install: (id, here) => new Promise((r) => (finish = () => (here.add(id), r({ ok: true, tail: [] })))) });
    await s.check();
    const first = s.install('gemini');
    await expect(s.install('opencode')).rejects.toThrow(/Another coding agent is installing/);
    finish();
    await first;
    await expect(s.install('gemini')).rejects.toThrow(/already installed/);
  });

  it("OpenCode's sign-in needs it installed, and its end goes on its card", async () => {
    let exited: (code: number) => void = () => undefined;
    const here = new Set<AgentCli>(['opencode']);
    const sent: CliView[][] = [];
    const s = new CliSetup({ detect: async () => view(here), install: async () => ({ ok: true, tail: [] }), signIn: (_t, e) => ((exited = e), { stop: () => undefined }), changed: (c) => sent.push(c) });
    here.delete('opencode');
    await s.check();
    expect(() => s.signIn()).toThrow(/OpenCode isn't installed/);
    here.add('opencode');
    await s.check();
    s.signIn();
    expect(sent.at(-1)!.find((c) => c.id === 'opencode')!.signIn).toEqual({ running: true, ok: false, note: '' });
    exited(0);
    await s.check();
    expect(sent.at(-1)!.find((c) => c.id === 'opencode')!.signIn).toEqual({ running: false, ok: true, note: 'Signed in.' });
  });
});

describe('npmInstall', () => {
  const dirs: string[] = [];
  afterEach(() => dirs.splice(0).forEach((d) => fs.rmSync(d, { recursive: true, force: true, maxRetries: 3 })));
  const tmp = () => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'cf-cli-'));
    dirs.push(d);
    return d;
  };
  /** A fake npm: records its arguments, and puts the command where npm -g --prefix would (or fails). */
  const fakeNpm = (dir: string, fail: boolean) => {
    const file = path.join(dir, 'npm.cjs');
    fs.writeFileSync(
      file,
      `const fs = require('fs'), path = require('path');
const args = process.argv.slice(2);
fs.writeFileSync(${JSON.stringify(path.join(dir, 'args.json'))}, JSON.stringify(args));
if (${fail}) { console.error('npm error code E404'); console.error('npm error 404 Not Found'); process.exit(1); }
const prefix = args[args.indexOf('--prefix') + 1];
const bin = process.platform === 'win32' ? prefix : path.join(prefix, 'bin');
fs.mkdirSync(bin, { recursive: true });
const cmd = path.join(bin, process.platform === 'win32' ? 'gemini.cmd' : 'gemini');
fs.writeFileSync(cmd, process.platform === 'win32' ? '@echo 0.68.0' : '#!/bin/sh\\necho 0.68.0\\n');
fs.chmodSync(cmd, 0o755);
console.log('added 1 package');`,
    );
    return { file: process.execPath, args: [file] };
  };

  it('installs the pinned package into the office’s prefix, where the office then finds it', async () => {
    const dir = tmp();
    const prefix = path.join(dir, 'cli');
    expect(resolveCommand('gemini', { PATH: '' }, [cliBinDir(prefix)])).toBeNull();
    const r = await npmInstall('gemini', { prefix, npm: fakeNpm(dir, false) });
    expect(r).toEqual({ ok: true, tail: ['added 1 package'] });
    expect(JSON.parse(fs.readFileSync(path.join(dir, 'args.json'), 'utf8'))).toEqual(npmInstallArgs(prefix, cliPackage('gemini')));
    expect(resolveCommand('gemini', { PATH: '' }, [cliBinDir(prefix)])).toBeTruthy();
  });

  it('a failure comes back with the log’s tail', async () => {
    const dir = tmp();
    const r = await npmInstall('gemini', { prefix: path.join(dir, 'cli'), npm: fakeNpm(dir, true) });
    expect(r).toEqual({ ok: false, tail: ['npm error code E404', 'npm error 404 Not Found'] });
  });
});

describe('the pure parts', () => {
  it('logTail keeps the last lines, colours and blanks gone', () => {
    expect(logTail('a\n\n\x1b[31mb\x1b[0m\nc\n', 2)).toEqual(['b', 'c']);
  });

  it("opencodeProviders reads `opencode auth list`'s credentials, not its environment", () => {
    const out = ['┌  Credentials ~/.local/share/opencode/auth.json', '│', '●  Anthropic oauth', '│', '●  OpenAI api', '│', '└  2 credentials', '', '┌  Environment', '│', '●  Google GEMINI_API_KEY', '└  1 environment variable'].join('\n');
    expect(opencodeProviders(out)).toEqual(['Anthropic', 'OpenAI']);
    expect(opencodeProviders('┌  Credentials ~/.local/share/opencode/auth.json\n└  0 credentials')).toEqual([]);
  });
});
