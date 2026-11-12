import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SessionOptions } from './agentRunner.ts';
import type { OfficeTools } from './ceo.ts';
import { createDemoBackend } from './demo.ts';
import { Swarm } from './swarm.ts';
import { IT_ID, loadIt, queueItJob, nextItJob, itDeptSettings, IT_DEPT_DEFAULTS, type ItJob, type ItState } from '../shared/itDept.ts';
import type { ItDeskState } from '../shared/itDesk.ts';
import type { PhoneMessage } from '../shared/types.ts';
import { excerpt } from '../shared/chat.ts';

// #524 through the office: the IT lead's own session (account, model, resume), its tools, the CEO's ask_it, the
// manager's Run checked by IT, and IT's own Telegram bot (or the CEO's, labelled "IT:").
type Internals = {
  ensureCeo(interrupted: unknown[]): void;
  officeTools(): OfficeTools;
  itTools(): OfficeTools;
  sessionAccount: Map<string, string | null>;
  state: { it: ItState; itDesk: ItDeskState; messages: PhoneMessage[] };
};

const TOKEN = '123456789:AAEdemoSECRETtokenSECRETtoken42424242';
const IT_TOKEN = '987654321:AAEdemoSECRETitBotSECRETtoken4242424';
const until = async (ok: () => boolean) => {
  for (let i = 0; i < 400 && !ok(); i++) await new Promise((r) => setTimeout(r, 10));
  expect(ok()).toBe(true);
};

let last: Swarm | null = null;
afterEach(async () => {
  vi.restoreAllMocks();
  await last?.accounts.flushed();
});

async function office() {
  const logs: string[] = [];
  for (const m of ['log', 'warn', 'error', 'info'] as const) vi.spyOn(console, m).mockImplementation((...a: unknown[]) => void logs.push(a.map(String).join(' ')));
  const backend = createDemoBackend();
  const started: SessionOptions[] = [];
  const start = backend.startSession;
  backend.startSession = (opts, cb) => {
    started.push(opts);
    return start(opts, cb);
  };
  const ran: string[][] = [];
  const exec = backend.itExec;
  backend.itExec = (argv, ms) => {
    ran.push(argv);
    return exec(argv, ms);
  };
  const swarm = (last = new Swarm(backend));
  await swarm.accounts.init();
  await swarm.telegram.remove(); // a clean start: tests share the demo's files
  await swarm.itBot.remove();
  const o = swarm as unknown as Internals;
  o.ensureCeo([]);
  const itSessions = () => started.filter((s) => s.dept === 'it');
  const itSaid = () => swarm.snapshot().it?.messages ?? [];
  return { swarm, o, logs, ran, itSessions, itSaid, sent: () => logs.filter((l) => l.startsWith('✈️ demo Telegram would send')) };
}

describe('the IT department', () => {
  it('answers in its own chat from its own session, on its own account and model, with it_run', async () => {
    const { swarm, o, ran, itSessions, itSaid } = await office();
    swarm.updateSettings({ itDept: { ...IT_DEPT_DEFAULTS, account: 'claude-apikey', model: 'claude-haiku-5-5', effort: 'low' } });
    await swarm.messageIt('How much disk is free?');
    expect(itSaid()[0]).toMatchObject({ from: 'manager', text: 'How much disk is free?' });
    await until(() => itSaid().some((m) => m.from === 'ceo'));
    const [s] = itSessions();
    expect(s).toMatchObject({ model: 'claude-haiku-5-5', effort: 'low', role: 'ceo' });
    expect(o.sessionAccount.get(IT_ID)).toBe('claude-apikey');
    expect(ran).toContainEqual(['df', '-h']);
    expect(itSaid().find((m) => m.from === 'ceo')!.text).toMatch(/free/);
    // The CEO chat heard none of it.
    expect(o.state.messages.some((m) => /disk is free/.test(m.text))).toBe(false);
  });

  it('gives it_run and it_propose to IT only; the CEO asks IT instead, in its thread', async () => {
    const { swarm, o, itSessions, itSaid } = await office();
    const it = o.itTools();
    expect(await it.call('it_run', { command: 'df -h' })).toMatch(/^\$ df -h\nexit 0/);
    const ceo = o.officeTools();
    await expect(ceo.call('it_run', { command: 'df -h' })).rejects.toThrow(/No office tool it_run/);
    await expect(ceo.call('it_propose', { argv: ['journalctl', '--vacuum-size=500M'], why: 'x', affects: 'x', undo: 'x', risk: 'low' })).rejects.toThrow(/No office tool/);
    expect(await ceo.call('ask_it', { question: 'Why is the disk at 95%?' })).toMatch(/Asked Iris/);
    expect(itSaid().at(-1)).toMatchObject({ from: 'office' });
    expect(itSaid().at(-1)!.text).toMatch(/Morgan asks: Why is the disk at 95%\?/);
    await until(() => itSessions().length > 0);
    expect(itSessions()[0].prompt).toMatch(/Morgan.*asks.*Why is the disk at 95%/s);
    swarm.updateSettings({ itDept: { ...IT_DEPT_DEFAULTS, on: false } });
    expect(await ceo.call('ask_it', { question: 'x' })).toMatch(/^Refused: The IT department is off/);
  });

  it("takes a reply with its quote to IT, and keeps the manager's reactions on IT's messages (#589)", async () => {
    const { swarm, itSessions, itSaid } = await office();
    await swarm.messageIt('How much disk is free?');
    await until(() => itSaid().some((m) => m.from === 'ceo'));
    const answer = itSaid().find((m) => m.from === 'ceo')!;
    await until(() => !swarm.snapshot().it?.busy);
    const { id } = await swarm.messageIt('Clean that up', undefined, undefined, answer.id);
    expect(itSaid().find((m) => m.id === id)).toMatchObject({ replyTo: answer.id });
    const forwarded = `(message ${id}) Replying to your message: «${excerpt(answer.text)}»\nClean that up`;
    await until(() => itSessions().some((s) => s.prompt.includes(forwarded)));
    expect(swarm.reactToItMessage(answer.id, '👍')).toEqual({ reactions: [{ by: 'manager', emoji: '👍' }] });
    expect(itSaid().find((m) => m.id === answer.id)!.reactions).toEqual([{ by: 'manager', emoji: '👍' }]);
    expect(swarm.reactToItMessage(answer.id, '👍')).toEqual({ reactions: [] }); // a second tap takes it back
    expect(() => swarm.reactToItMessage(id, '👍')).toThrow(/Only Iris's messages/);
    expect(() => swarm.reactToItMessage(answer.id, '🦄')).toThrow(/Pick a reaction/);
    expect(() => swarm.reactToItMessage(99999, '👍')).toThrow(/no longer saved/);
  });

  it('resumes its session after an office restart', async () => {
    const { swarm, o, itSessions } = await office();
    o.state.it = loadIt({ ...o.state.it, sessionId: 'demo-it-123', sessionCli: 'claude', job: { kind: 'chat', text: 'cut off', messageIds: [], at: 1 } });
    expect(o.state.it.queue[0]).toMatchObject({ kind: 'chat', text: 'cut off' });
    o.state.it.queue = [];
    await swarm.messageIt('Still there?');
    await until(() => itSessions().length > 0);
    expect(itSessions()[0].resumeSessionId).toBe('demo-it-123');
  });

  it("runs a proposal on the manager's Run, then IT checks it and reports with evidence", async () => {
    const { swarm, o, ran, itSessions, itSaid } = await office();
    expect(await o.itTools().call('it_propose', { argv: ['journalctl', '--vacuum-size=500M'], why: 'Old logs', affects: 'frees 3.4 GB', undo: "can't be undone", risk: 'low' })).toMatch(/Nothing has run/);
    expect(o.state.itDesk.waiting[0].by).toBe('Iris');
    await swarm.itRunProposals([o.state.itDesk.waiting[0].id]);
    expect(ran).toEqual([['journalctl', '--vacuum-size=500M']]);
    expect(itSaid().some((m) => m.from === 'office' && /Ran `journalctl --vacuum-size=500M`/.test(m.text))).toBe(true);
    await until(() => itSessions().length > 0);
    expect(itSessions()[0].prompt).toMatch(/The manager ran `journalctl --vacuum-size=500M`: exit 0[\s\S]*Check/);
    await until(() => itSaid().some((m) => m.from === 'ceo'));
    expect(ran).toContainEqual(['df', '-h']); // the check after
  });

  it('links its own Telegram bot with a /start code; a message reaches IT; a button runs a proposal and replies', async () => {
    const { swarm, o, ran, itSaid, sent } = await office();
    await swarm.itBot.setToken(IT_TOKEN);
    swarm.itTelegramDemo({ kind: 'start' });
    await until(() => !!swarm.snapshot().it?.telegram.linked);
    expect(sent().at(-1)).toMatch(/Linked to your cubefarm office's IT department/);
    swarm.itTelegramDemo({ kind: 'message', text: 'Is the disk ok?' });
    await until(() => itSaid().some((m) => m.text === 'Is the disk ok?'));
    expect(itSaid().find((m) => m.text === 'Is the disk ok?')).toMatchObject({ from: 'manager', telegram: 'in' });
    expect(o.state.messages.some((m) => m.text === 'Is the disk ok?')).toBe(false);
    // A proposal comes with Run / Not now; Run on Telegram runs it and the result comes back there.
    await o.itTools().call('it_propose', { argv: ['docker', 'image', 'prune', '-af'], why: 'Unused images', affects: 'frees 8.9 GB', undo: 'pulled again', risk: 'medium' });
    await until(() => sent().some((l) => l.includes('docker image prune -af') && l.includes('[Run]') && l.includes('[Not now]')));
    swarm.itTelegramDemo({ kind: 'approve' });
    await until(() => ran.some((a) => a.join(' ') === 'docker image prune -af'));
    await until(() => sent().some((l) => /Ran `docker image prune -af`/.test(l)));
    await until(() => !o.state.itDesk.waiting.length);
    await swarm.itBot.stop();
  });

  it("sends IT's alerts on the CEO's bot, labelled IT:, when IT has no bot of its own", async () => {
    const { swarm, o, sent } = await office();
    await swarm.telegram.setToken(TOKEN);
    swarm.telegramDemo({ kind: 'start' });
    await until(() => swarm.snapshot().notifyChannels.telegram.linked);
    await o.itTools().call('it_propose', { argv: ['journalctl', '--vacuum-size=500M'], why: 'Old logs', affects: 'frees 3.4 GB', undo: "can't", risk: 'low' });
    await until(() => sent().some((l) => /IT: .*journalctl --vacuum-size=500M/.test(l) && l.includes('[Run]')));
    // Its button on the CEO's bot runs it too.
    swarm.telegramDemo({ kind: 'approve' });
    await until(() => !o.state.itDesk.waiting.length);
    await until(() => sent().some((l) => /IT: .*Ran `journalctl --vacuum-size=500M`/.test(l)));
    await swarm.telegram.stop();
  });
});

describe('the IT department, pure', () => {
  it('keeps settings in range and falls back to what was there', () => {
    expect(itDeptSettings(undefined, {})).toEqual(IT_DEPT_DEFAULTS);
    expect(itDeptSettings(IT_DEPT_DEFAULTS, { name: '  Ines  ', effort: 'huge', cli: 'nope', on: false })).toMatchObject({ name: 'Ines', effort: 'medium', cli: 'claude', on: false });
  });

  it("folds the manager's messages into one waiting chat job, and takes them first", () => {
    const q: ItJob[] = [];
    queueItJob(q, { kind: 'ran', line: 'x', code: 0, out: '', at: 1 });
    queueItJob(q, { kind: 'chat', text: 'a', messageIds: [1], at: 2 });
    queueItJob(q, { kind: 'chat', text: 'b', messageIds: [2], at: 3 });
    expect(q).toHaveLength(2);
    expect(nextItJob(q)).toMatchObject({ kind: 'chat', text: 'a\nb', messageIds: [1, 2] });
    expect(nextItJob(q)).toMatchObject({ kind: 'ran' });
  });
});
