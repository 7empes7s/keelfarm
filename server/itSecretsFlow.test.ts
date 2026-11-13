import fs from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createDemoBackend } from './demo.ts';
import { Swarm } from './swarm.ts';
import { HOME_DIR } from './config.ts';
import { headersFor } from './providerActions/http.ts';
import type { ActionRequest } from './providerActions/types.ts';
import type { OfficeTools } from './ceo.ts';
import type { ItDeskState } from '../shared/itDesk.ts';
import type { PhoneMessage, ServerEvent } from '../shared/types.ts';

// #625 through the office: a credential file is used and written (never printed), every IT output is masked with the
// stored keys and the values of the files a command names, and app_call reaches a live app past Access with the
// service token from its env file in the headers only. No secret is in a tool output, the log, IT's chat or a broadcast.
type Internals = {
  ensureCeo(interrupted: unknown[]): void;
  itTools(): OfficeTools;
  broadcast(ev: ServerEvent): void;
  state: { itDesk: ItDeskState; it: { messages: PhoneMessage[] } };
};

const TOKEN_ID = 'f00dcafe1234.access';
const TOKEN_SECRET = 'clipRunnerSecretValue77';
const TOKEN_FILE = path.join(HOME_DIR, 'secrets', 'cf-access-clipfarm-office-runner.env');
const DB_PASSWORD = 'hunter2hunter2';
const STORED = 'plainstoredvalue42';

async function office(out = '') {
  await fs.mkdir(path.dirname(TOKEN_FILE), { recursive: true });
  await fs.writeFile(TOKEN_FILE, `CF_ACCESS_CLIENT_ID=${TOKEN_ID}\nCF_ACCESS_CLIENT_SECRET=${TOKEN_SECRET}\n`);
  const backend = createDemoBackend();
  const ran: string[][] = [];
  backend.itExec = async (argv) => (ran.push(argv), { code: 0, out, err: '' });
  await backend.itFiles.write('/opt/postiz/.env', `DATABASE_PASSWORD=${DB_PASSWORD}\n`, 0o600);
  const calls: (ActionRequest & { key: string })[] = [];
  const http = backend.providerHttp;
  backend.providerHttp = (key, req) => (calls.push({ ...req, key }), http(key, req));
  const swarm = new Swarm(backend);
  const o = swarm as unknown as Internals;
  const sent: string[] = [];
  const broadcast = o.broadcast.bind(o);
  o.broadcast = (ev) => (sent.push(JSON.stringify(ev)), broadcast(ev));
  o.ensureCeo([]);
  return { swarm, o, ran, calls, sent, tools: o.itTools() };
}

const nowhere = (o: Internals, sent: string[], outs: string[], secrets: string[]) => {
  const all = [...outs, JSON.stringify(o.state.itDesk), JSON.stringify(o.state.it.messages), ...sent].join('\n');
  for (const s of secrets) expect(all).not.toContain(s);
};

describe('secret files on the IT desk (#625)', () => {
  it('runs a write naming a credential file on Run, its output masked with what the file holds', async () => {
    const { swarm, o, ran, sent, tools } = await office(`wrote DATABASE_PASSWORD ${DB_PASSWORD} and ${STORED}`);
    await swarm.providers.add('other-key', STORED, 'Postiz admin');
    const card = await tools.call('it_propose', { argv: ['install', '-m600', '/tmp/x', '/opt/postiz/.env'], why: 'Postiz env', affects: '/opt/postiz/.env', undo: 'backup kept', risk: 'low' });
    expect(card).toMatch(/Nothing has run/);
    await swarm.itRunProposals([o.state.itDesk.waiting[0].id]);
    expect(ran).toEqual([['install', '-m600', '/tmp/x', '/opt/postiz/.env']]);
    const out = o.state.itDesk.log[0].out;
    expect(out).toContain('••••ter2');
    expect(out).toContain('••••ue42');
    nowhere(o, sent, [card], [DB_PASSWORD, STORED]);
  });

  it('refuses printing one, with a hint, and runs nothing', async () => {
    const { ran, tools } = await office();
    expect(await tools.call('it_propose', { argv: ['cat', '/opt/postiz/.env'], why: 'x', affects: 'x', undo: 'x', risk: 'low' })).toMatch(/^Refused: cat would print .*test -s/);
    expect(await tools.call('it_run', { command: 'printenv' })).toMatch(/^Refused: printenv prints the environment/);
    expect(ran).toEqual([]);
  });
});

describe('app_call (#625)', () => {
  it('calls the live app with the token from its env file in the headers, and never shows it', async () => {
    const { o, calls, sent, tools } = await office();
    const out = await tools.call('app_call', { method: 'GET', url: 'https://clip.techinsiderbytes.com/api/settings' });
    expect(out).toMatch(/^\$ app_call GET https:\/\/clip\.techinsiderbytes\.com\/api\/settings\nHTTP 200\n/);
    expect(out).toMatch(/"clipsToday": 7/);
    expect(out).not.toContain('whsec_DemoAppSecret'); // the app's own secret-looking field, masked
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ method: 'GET', auth: 'cf-access', key: `${TOKEN_ID}:${TOKEN_SECRET}` });
    expect(headersFor(calls[0].key, calls[0])).toEqual({ 'CF-Access-Client-Id': TOKEN_ID, 'CF-Access-Client-Secret': TOKEN_SECRET });
    expect(o.state.itDesk.log[0]).toMatchObject({ kind: 'read', argv: ['app_call', 'GET', 'https://clip.techinsiderbytes.com/api/settings'], code: 0 });
    nowhere(o, sent, [out], [TOKEN_ID, TOKEN_SECRET]);
  });

  it('refuses hosts and methods off the list, and KEEL writes', async () => {
    const { calls, tools } = await office();
    expect(await tools.call('app_call', { method: 'GET', url: 'https://example.com/x' })).toMatch(/^Refused: example\.com isn't on app_call's list/);
    expect(await tools.call('app_call', { method: 'POST', url: 'https://keel.techinsiderbytes.com/api/x' })).toMatch(/^Refused: POST isn't allowed on keel/);
    expect(await tools.call('app_call', { method: 'GET', url: 'http://clip.techinsiderbytes.com/' })).toMatch(/https only/);
    expect(calls).toEqual([]);
  });
});
