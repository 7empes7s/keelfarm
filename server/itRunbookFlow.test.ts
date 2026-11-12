import { describe, expect, it, vi } from 'vitest';
import type { ItDeskState } from '../shared/itDesk.ts';
import type { ItDeptSettings, ItJob, ItState } from '../shared/itDept.ts';
import type { PhoneMessage } from '../shared/types.ts';
import type { OfficeTools } from './ceo.ts';
import { createDemoBackend } from './demo.ts';
import { DEMO_RUNBOOK, DEMO_RUNBOOK_PATH } from './demo/runbookSample.ts';
import { memoryFiles } from './itFiles.ts';
import { Swarm } from './swarm.ts';

// #611 through the office: it_runbook reads the floor's runbook and runs it as one job (no tap inside auto-approve, else
// one card), with progress on the IT desk, the result in IT's chat and the CEO's, and an Undo for all of it. No secret
// value shows anywhere: the chats, the IT desk's log, the daily log, the snapshot.
type Internals = {
  ensureCeo(interrupted: unknown[]): void;
  itTools(): OfficeTools;
  enqueueIt(job: ItJob): void;
  history: { note(text: string): Promise<void> };
  providers: { keysFor(provider: string): { id: string; label: string; key: string }[] };
  state: { itDesk: ItDeskState; it: ItState & { messages: PhoneMessage[] }; settings: { itDept: ItDeptSettings } };
};

async function office(level: ItDeptSettings['autoApprove'], runbook = DEMO_RUNBOOK) {
  const backend = createDemoBackend();
  const files = memoryFiles({
    '/opt/postiz/.env.example': 'JWT_SECRET=\nDATABASE_PASSWORD=change-me\n',
    '/opt/postiz/docker-compose.yml': 'services: {}\n',
    '/opt/postiz/postiz.service': '[Service]\n',
    '/etc/caddy/Caddyfile': 'a.example.com {\n}\n',
  });
  backend.itFiles = files;
  const ran: string[][] = [];
  backend.itExec = async (argv) => {
    ran.push(argv);
    return { code: 0, out: argv[0] === 'curl' ? 'ok' : '', err: '' };
  };
  const read = backend.readRepoFile;
  backend.readRepoFile = (fullName, branch, rel) => (rel === DEMO_RUNBOOK_PATH ? Promise.resolve(runbook) : read(fullName, branch, rel));
  const swarm = new Swarm(backend);
  await swarm.connectRepo('demo-co/pixel-todo', {});
  const o = swarm as unknown as Internals;
  o.ensureCeo([]);
  o.state.settings.itDept.autoApprove = level;
  o.providers.keysFor = (p) => (p === 'openai' ? [{ id: 'k1', label: 'OpenAI API', key: 'sk-demo-openai-0000000000001a2b' }] : []); // the demo's, which init() loads
  const woke: ItJob[] = [];
  o.enqueueIt = (j) => void woke.push(j);
  const notes: string[] = [];
  o.history.note = async (t) => void notes.push(t);
  const call = () => o.itTools().call('it_runbook', { floor: 1, path: DEMO_RUNBOOK_PATH, project: 'postiz' });
  const job = () => o.state.itDesk.runbooks![0];
  const ended = () => vi.waitFor(() => expect(['done', 'failed']).toContain(job().state));
  return { swarm, o, files, ran, woke, notes, call, job, ended };
}

describe('runbook jobs in the office', () => {
  it('Routine: one job with no tap, the check last, the result to IT and the CEO, no secret anywhere, and the Undo', async () => {
    const { swarm, o, files, ran, notes, call, job, ended } = await office('routine');
    expect(await call()).toMatch(/^Started "Install Postiz" .*inside auto-approve, so no tap/);
    await ended();
    expect(job()).toMatchObject({ state: 'done', auto: true, check: { ok: true, out: 'ok' }, undoable: true });
    expect(job().summary).toBe('9 steps, touches /opt/postiz, a systemd unit postiz, docker compose for postiz, the Caddy block for postiz.example.com');
    expect(ran.at(-1)).toEqual(['curl', '-fsS', '--max-time', '20', 'https://postiz.example.com/']);
    expect(o.state.itDesk.waiting).toEqual([]);
    const cards = o.state.it.messages.filter((m) => m.itRunbook?.job === job().id);
    expect(cards.map((m) => m.text)).toEqual([expect.stringMatching(/^📋 Install Postiz: 9 steps, .*Running it without a tap/), '✅ Install Postiz: all 9 steps done, health check green. Undo puts it all back.']);
    const snap = JSON.stringify(swarm.snapshot());
    expect(snap).toContain('IT: ✅ Install Postiz: all 9 steps done, health check green.'); // the CEO's chat

    const env = files.files.get('/opt/postiz/.env')!;
    expect(env.mode).toBe(0o600);
    const secrets = [env.data.match(/^JWT_SECRET=(\w+)$/m)![1], env.data.match(/^DATABASE_PASSWORD=(\w+)$/m)![1], env.data.match(/^OPENAI_API_KEY=(.+)$/m)![1]];
    expect(secrets[2]).toBe('sk-demo-openai-0000000000001a2b'); // by reference, from Providers
    const everything = [snap, JSON.stringify(o.state.it.messages), JSON.stringify(o.state.itDesk), notes.join('\n')].join('\n');
    for (const s of secrets) expect(everything).not.toContain(s);
    expect(everything).toContain('OPENAI_API_KEY (set, ends …1a2b), from Providers (openai)');

    await swarm.itRunbookUndo(job().id);
    expect(job().state).toBe('undone');
    expect(files.files.has('/opt/postiz/.env')).toBe(false);
    expect(files.files.has('/etc/systemd/system/postiz.service')).toBe(false);
    expect(files.files.get('/etc/caddy/Caddyfile')!.data).toBe('a.example.com {\n}\n');
    expect(ran).toContainEqual(['systemctl', 'disable', '--now', 'postiz.service']);
    await expect(swarm.itRunbookUndo(job().id)).rejects.toThrow(/no Undo/);
  });

  it('a step outside the policy makes the whole job one card; Approve runs it all, Not now runs nothing', async () => {
    const { swarm, o, ran, call, job, ended } = await office('routine', DEMO_RUNBOOK.replace('systemctl daemon-reload', 'systemctl restart nginx'));
    expect(await call()).toMatch(/^On the manager's card as one job \(auto-approve: step 6, `systemctl restart nginx`/);
    expect(job()).toMatchObject({ state: 'waiting', auto: false, held: expect.stringMatching(/^step 6/) });
    expect(ran).toEqual([]);
    expect(await call()).toMatch(/already on the manager's card/);
    swarm.itRunbookDecide(job().id, true);
    expect(() => swarm.itRunbookDecide(job().id, true)).toThrow(/has run or gone/); // a second tap
    await ended();
    expect(job().state).toBe('done');
    expect(ran).toContainEqual(['systemctl', 'restart', 'nginx']);

    const off = await office('off');
    await off.call();
    off.swarm.itRunbookDecide(off.job().id, false);
    expect(off.job().state).toBe('dismissed');
    expect(off.ran).toEqual([]);
    expect(o.state.it.messages.length).toBeGreaterThan(0);
  });

  it('a failed step stops the job, says where, and wakes IT to look', async () => {
    const { o, woke, call, job, ended } = await office('routine');
    const backend = (o as unknown as { backend: { itExec: (a: string[]) => Promise<unknown> } }).backend;
    backend.itExec = async (argv: string[]) => (argv[0] === 'docker' && argv.includes('up') ? { code: 1, out: '', err: 'port 5000 is taken' } : { code: 0, out: '', err: '' });
    await call();
    await ended();
    expect(job().state).toBe('failed');
    expect(o.state.it.messages.at(-1)!.text).toBe('⚠️ Install Postiz stopped at step 4 of 9. Undo puts it all back.');
    expect(woke.at(-1)).toMatchObject({ kind: 'ran', line: 'runbook Install Postiz', out: expect.stringContaining('port 5000 is taken') });
  });

  it('refuses a project that is the office or KEEL, and a missing Providers key, before anything runs', async () => {
    const { o, ran } = await office('routine', DEMO_RUNBOOK.replace('provider:openai', 'provider:twitch'));
    expect(await o.itTools().call('it_runbook', { floor: 1, path: DEMO_RUNBOOK_PATH, project: 'keel' })).toMatch(/never touch those/);
    expect(await o.itTools().call('it_runbook', { floor: 1, path: DEMO_RUNBOOK_PATH, project: 'postiz' })).toMatch(/needs a twitch key/);
    expect(ran).toEqual([]);
  });
});
