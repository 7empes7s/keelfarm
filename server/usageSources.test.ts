import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { nextRead, POLL_EVERY, sourcesSignature, UsageBoard, UsageFetchError, type UsageApi, type UsageKeys } from './usageSources.ts';
import { rateLimitsAnswer } from './codexLimits.ts';
import type { UsageSource } from '../shared/types.ts';

const KEYS: UsageKeys = { elevenlabs: 'xi-secret-key-1234', anthropic: 'sk-ant-admin-secret-5678', openai: '' };
const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((d) => fs.rm(d, { recursive: true, force: true })));
});

async function board(api: UsageApi, keys: UsageKeys = KEYS) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'usage-'));
  dirs.push(dir);
  let changes = 0;
  const b = new UsageBoard({ api, keys: () => keys, boxes: () => ({ total: 3, running: 1, limit: 10 }), spend: () => [], alertsFile: path.join(dir, 'usage-alerts.json'), changed: () => changes++ });
  return { b, dir, changes: () => changes };
}

const settle = () => new Promise((r) => setTimeout(r, 20));

describe('UsageBoard', () => {
  it('reads each provider whose key is saved, and only those', async () => {
    const calls: string[] = [];
    const { b } = await board({
      elevenLabs: async () => (calls.push('eleven'), { tier: 'starter', character_count: 10, character_limit: 100 }),
      costs: async (p) => (calls.push(p), { data: [{ results: [{ currency: 'USD', amount: '500' }] }] }),
    });
    b.tick(Date.now());
    await settle();
    expect(calls).toEqual(['eleven', 'anthropic']);
    expect(b.sources([]).map((s) => [s.id, s.windows[0]?.usedPct ?? s.windows[0]?.used])).toEqual([
      ['upstash', 30],
      ['elevenlabs', 10],
      ['anthropic-org', 5],
    ]);
    b.tick(Date.now()); // not due again yet
    await settle();
    expect(calls).toHaveLength(2);
  });

  it('backs off a failing read and never puts a key in a source or its note', async () => {
    const { b } = await board({
      elevenLabs: async (key) => {
        throw new Error(`boom ${key}`); // even an error that carries the key
      },
      costs: async () => {
        throw new UsageFetchError(401);
      },
    });
    b.tick(Date.now());
    await settle();
    const json = JSON.stringify(b.sources([]));
    expect(json).not.toContain(KEYS.elevenlabs);
    expect(json).not.toContain(KEYS.anthropic);
    const by = (id: string) => b.sources([]).find((s) => s.id === id) as UsageSource;
    expect(by('elevenlabs')).toMatchObject({ status: 'error', note: "Couldn't reach it; trying again later" });
    expect(by('anthropic-org')).toMatchObject({ status: 'error', note: 'The key was turned away (401)' });
    expect(nextRead(0, POLL_EVERY.elevenlabs, 3)).toBe(8 * POLL_EVERY.elevenlabs);
    expect(nextRead(0, POLL_EVERY['anthropic-org'], 10)).toBe(4 * 60 * 60_000);
  });

  it('notifies a window crossing 90% once, even across a restart', async () => {
    const api: UsageApi = { elevenLabs: async () => ({}), costs: async () => ({}) };
    const { b, dir } = await board(api, { elevenlabs: '', anthropic: '', openai: '' });
    const hot: UsageSource = { id: 'claude-login', provider: 'claude', category: 'coding', label: 'Claude login', plan: 'Max', windows: [{ name: 'Weekly', usedPct: 93, resetsAt: Date.now() + 5 * 3_600_000 }], status: 'near', checkedAt: Date.now() };
    expect((await b.check([hot])).map((a) => a.title)).toEqual(['Claude login is at 93%']);
    expect(await b.check([hot])).toEqual([]);
    const restarted = new UsageBoard({ api, keys: () => ({ elevenlabs: '', anthropic: '', openai: '' }), boxes: () => null, spend: () => [], alertsFile: path.join(dir, 'usage-alerts.json'), changed: () => undefined });
    expect(await restarted.check([hot])).toEqual([]);
    expect(await fs.readFile(path.join(dir, 'usage-alerts.json'), 'utf8')).not.toContain('sk-');
  });
});

describe('sending the rows', () => {
  it('only when something but a read time changed', () => {
    const row: UsageSource = { id: 'elevenlabs', provider: 'elevenlabs', category: 'audio', label: 'ElevenLabs', plan: '', windows: [{ name: 'Characters', usedPct: 61, resetsAt: null }], status: 'ready', checkedAt: 1 };
    expect(sourcesSignature([{ ...row, checkedAt: 2 }])).toBe(sourcesSignature([row]));
    expect(sourcesSignature([{ ...row, windows: [{ name: 'Characters', usedPct: 62, resetsAt: null }] }])).not.toBe(sourcesSignature([row]));
  });
});

describe('codex app-server', () => {
  it("picks the rate-limits answer out of app-server's other messages", () => {
    const out = ['{"id":1,"result":{"userAgent":"cubefarm/0.166.0"}}', '{"method":"account/updated","params":{"authMode":"chatgpt","planType":"plus"}}', '{"id":2,"result":{"rateLimits":{"primary":{"usedPercent":0,"windowDurationMins":300,"resetsAt":1794117952}}}}', ''].join('\n');
    expect(rateLimitsAnswer(out)).toEqual({ rateLimits: { primary: { usedPercent: 0, windowDurationMins: 300, resetsAt: 1794117952 } } });
    expect(rateLimitsAnswer(out.split('\n').slice(0, 2).join('\n'))).toBeUndefined();
    expect(rateLimitsAnswer('{"id":2,"error":{"code":-32600,"message":"not signed in"}}')).toEqual({ error: true });
  });
});
