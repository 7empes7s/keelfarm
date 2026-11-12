import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SessionOptions } from './agentRunner.ts';
import type { OfficeTools } from './ceo.ts';
import { createDemoBackend } from './demo.ts';
import { Swarm } from './swarm.ts';
import { SNOOZE_MS, openRecs, type ItWatchState } from '../shared/itWatch.ts';
import type { ItState } from '../shared/itDept.ts';

// #525 through the office: a check crossing its line wakes IT once with the facts, IT's card has ranked options, the
// manager's pick runs through the IT desk, the checks are read again and the before/after posted; Not now snoozes a
// day; the card and its buttons on IT's Telegram bot. The demo's IT lead answers (server/demo/itDesk.ts).
type Internals = { ensureCeo(interrupted: unknown[]): void; itTools(): OfficeTools; state: { it: ItState; itWatch: ItWatchState } };

const IT_TOKEN = '987654321:AAEdemoSECRETitBotSECRETtoken4242424';
const GB = 1024;
const until = async (ok: () => boolean) => {
  for (let i = 0; i < 1000 && !ok(); i++) await new Promise((r) => setTimeout(r, 10));
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
  const disk = { freeGb: 7.9 };
  backend.disk.read = async (dirs) => dirs.map((d) => ({ ...d, totalMb: 150 * GB, freeMb: disk.freeGb * GB }));
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
    if (argv.includes('prune')) disk.freeGb = 25; // the clean-up freed space
    return exec(argv, ms);
  };
  const swarm = (last = new Swarm(backend));
  await swarm.telegram.remove();
  await swarm.itBot.remove();
  const o = swarm as unknown as Internals;
  o.ensureCeo([]);
  /** Each IT session is one model call: a wake. */
  const wakes = () => started.filter((s) => s.dept === 'it');
  const itSaid = () => swarm.snapshot().it?.messages ?? [];
  const idle = () => !o.state.it.job && !o.state.it.queue.length && !swarm.snapshot().it?.busy;
  return { swarm, o, disk, ran, wakes, itSaid, idle, sent: () => logs.filter((l) => l.startsWith('✈️ demo Telegram would send')) };
}

describe('IT monitoring', () => {
  it('wakes IT once on a crossing, never again at the same level; a pick runs, re-measures and posts before/after', async () => {
    const { swarm, o, ran, wakes, itSaid, idle } = await office();
    const view = await swarm.itWatchTick();
    expect(view.checks.find((c) => c.id === 'disk')).toMatchObject({ level: 'bad', line: expect.stringMatching(/^7\.9 GB free on system disk .*\(\/\)$/) });
    await until(() => wakes().length === 1);
    expect(wakes()[0].prompt).toMatch(/checks got worse:\n- Disk is BAD: 7\.9 GB free[\s\S]*it_recommend/);
    // IT's card: ranked options, in the view (chat and Health page).
    await until(() => o.state.itWatch.recs.length === 1);
    const rec = o.state.itWatch.recs[0];
    expect(rec).toMatchObject({ check: 'disk', by: 'Iris', snoozedUntil: null });
    expect(rec.options.map((x) => x.argv.join(' '))).toEqual(['docker image prune -af', 'journalctl --vacuum-size=500M', 'docker builder prune -f']);
    await until(idle);

    // The same level again: no model call.
    await swarm.itWatchTick();
    await swarm.itWatchTick();
    await new Promise((r) => setTimeout(r, 100));
    expect(wakes()).toHaveLength(1);

    // The manager picks the first option: it runs through the IT desk, and the office measures again.
    const r = await swarm.itPick(rec.id, 0);
    expect(r.code).toBe(0);
    expect(ran).toContainEqual(['docker', 'image', 'prune', '-af']);
    expect(itSaid().some((m) => m.from === 'office' && /Remove unused Docker images ran\. Before: 7\.9 GB free .*\(bad\) → after: 25\.0 GB free .*\(good\)/.test(m.text))).toBe(true);
    expect(swarm.itWatchView().checks.find((c) => c.id === 'disk')!.level).toBe('good');
    expect(o.state.itWatch.recs).toEqual([]); // good again: the card is done
    await new Promise((r) => setTimeout(r, 300));
    expect(wakes()).toHaveLength(1); // the office reports before/after itself: IT isn't woken to check
    await expect(swarm.itPick(rec.id, 0)).rejects.toThrow(/handled or replaced/);
  });

  it('Not now snoozes a recommendation for a day: hidden, and its check wakes nobody', async () => {
    const { swarm, o } = await office();
    await o.itTools().call('it_recommend', { check: 'docker', title: 'Docker: 12 GB reclaimable', evidence: 'Images 8.9 GB, build cache 3 GB', options: [{ argv: ['docker', 'builder', 'prune', '-f'], does: 'Clear the build cache', frees: 'frees 3 GB', risk: 'low', undo: 'rebuilt' }] });
    const [rec] = o.state.itWatch.recs;
    const before = Date.now();
    const { snoozedUntil } = swarm.itSnooze(rec.id);
    expect(snoozedUntil - before).toBeGreaterThanOrEqual(SNOOZE_MS - 50);
    expect(snoozedUntil - before).toBeLessThanOrEqual(SNOOZE_MS + 50);
    expect(openRecs(o.state.itWatch.recs, Date.now())).toEqual([]);
    expect(openRecs(o.state.itWatch.recs, snoozedUntil + 1)).toHaveLength(1);
  });

  it('refuses options the never-list forbids, before they reach the manager', async () => {
    const { o } = await office();
    const out = await o.itTools().call('it_recommend', { check: 'docker', title: 't', evidence: 'e', options: [{ argv: ['docker', 'volume', 'prune', '-f'], does: 'x', frees: 'y', risk: 'low', undo: 'z' }] });
    expect(out).toMatch(/Option 1: Never, even with the manager's Run: docker volume prune/);
    expect(o.state.itWatch.recs).toEqual([]);
  });

  it("puts the card on IT's Telegram bot with a button per option; a tap runs it, Not now snoozes", async () => {
    const { swarm, o, ran, sent } = await office();
    await swarm.itBot.setToken(IT_TOKEN);
    swarm.itTelegramDemo({ kind: 'start' });
    await until(() => !!swarm.snapshot().it?.telegram.linked);
    await swarm.itWatchTick();
    await until(() => sent().some((l) => l.includes('Disk: ') && l.includes('[1. Remove unused Docker images]') && l.includes('[Not now]')));
    swarm.itTelegramDemo({ kind: 'approve' });
    await until(() => ran.some((a) => a.join(' ') === 'docker image prune -af'));
    await until(() => sent().some((l) => /Before: 7\.9 GB free .* → after: 25\.0 GB free/.test(l)));
    expect(o.state.itWatch.recs).toEqual([]);

    await o.itTools().call('it_recommend', { check: 'logs', title: 'Logs: 3.9 GB', evidence: 'journal 3.9 GB', options: [{ argv: ['journalctl', '--vacuum-size=500M'], does: 'Trim the logs', frees: 'frees 3.4 GB', risk: 'low', undo: "can't" }] });
    await until(() => sent().some((l) => l.includes('[1. Trim the logs]')));
    swarm.itTelegramDemo({ kind: 'decline' });
    await until(() => !!o.state.itWatch.recs[0]?.snoozedUntil);
    expect(ran.some((a) => a[0] === 'journalctl' && a[1] === '--vacuum-size=500M')).toBe(false);
    await swarm.itBot.stop();
  }, 20_000);
});
