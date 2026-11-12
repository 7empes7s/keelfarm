import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import type { ServerEvent } from '../shared/types.ts';

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'cubefarm-keyscan-'));
process.env.SWARM_HOME = home;
const { scanForKeys } = await import('./keyScan.ts');
const { DEMO_FOUND_KEYS } = await import('./demo/providers.ts');
const { createDemoBackend } = await import('./demo.ts');
const { Swarm } = await import('./swarm.ts');
afterAll(() => fs.rmSync(home, { recursive: true, force: true, maxRetries: 5 }));

const write = (file: string, text: string) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
};

describe('the scan', () => {
  it('reads env and JSON files from the archive and the live files, then deletes its temp folder', async () => {
    const tmpRoot = fs.mkdtempSync(path.join(home, 'tmp-'));
    const live = path.join(home, 'opencode.json');
    write(live, JSON.stringify({ provider: { openrouter: { options: { apiKey: 'sk-or-v1-live-1111' } } } }));
    let mode = 0;
    const keys = await scanForKeys({
      archives: [path.join(home, 'configs.tar.zst'), path.join(home, 'gone.tar.zst')],
      files: [live, path.join(home, 'missing.json')],
      tmpRoot,
      exists: async (f) => !f.includes('gone') && !f.includes('missing'),
      list: async () => ['etc/litellm/litellm.env', 'etc/litellm/', 'opt/newsbites/app.py', 'opt/newsbites/.env'],
      extract: async (_archive, dir, names) => {
        mode = fs.statSync(dir).mode & 0o777;
        expect(names).toEqual(['etc/litellm/litellm.env', 'opt/newsbites/.env']);
        write(path.join(dir, 'etc/litellm/litellm.env'), 'GEMINI_API_KEY=AIza-fake-0001\nLITELLM_MASTER_KEY=sk-master-0000\n');
        write(path.join(dir, 'opt/newsbites/.env'), 'GROQ_API_KEY=gsk_fake_0002\n');
        write(path.join(dir, 'opt/newsbites/app.py'), 'OPENAI_API_KEY=sk-not-read-0003\n');
      },
    });
    expect(keys).toEqual([
      { variable: 'GEMINI_API_KEY', value: 'AIza-fake-0001', source: 'LiteLLM litellm.env' },
      { variable: 'LITELLM_MASTER_KEY', value: 'sk-master-0000', source: 'LiteLLM litellm.env' },
      { variable: 'GROQ_API_KEY', value: 'gsk_fake_0002', source: 'NewsBites .env' },
      { variable: 'OPENROUTER_API_KEY', value: 'sk-or-v1-live-1111', source: 'OpenCode opencode.json' },
    ]);
    if (process.platform !== 'win32') expect(mode).toBe(0o700);
    expect(fs.readdirSync(tmpRoot)).toEqual([]);
  });

  it('deletes its temp folder even when extracting fails', async () => {
    const tmpRoot = fs.mkdtempSync(path.join(home, 'tmp-'));
    await expect(
      scanForKeys({
        archives: [path.join(home, 'configs.tar.zst')],
        files: [],
        tmpRoot,
        exists: async () => true,
        list: async () => ['a/.env'],
        extract: async (_a, dir) => {
          write(path.join(dir, 'a/.env'), 'OPENAI_API_KEY=sk-half-extracted\n');
          throw new Error('zstd: corrupted block');
        },
      }),
    ).rejects.toThrow('zstd');
    expect(fs.readdirSync(tmpRoot)).toEqual([]);
  });
});

describe('keys found on this computer, in the office', () => {
  it('scans the fake archive, tests each key, never shows a value, and imports the selected ones as connections', async () => {
    const swarm = new Swarm(createDemoBackend());
    const events: ServerEvent[] = [];
    const inside = swarm as unknown as { broadcast(ev: ServerEvent): void; initProviders(): Promise<void> };
    inside.broadcast = (ev) => void events.push(ev);
    await inside.initProviders();

    const view = await swarm.scanKeys();
    expect(view.state).toBe('done');
    const gemini = view.keys.find((k) => k.provider === 'gemini')!;
    expect(gemini).toMatchObject({ keyHint: DEMO_FOUND_KEYS.find((k) => k.variable === 'GEMINI_API_KEY')!.value.slice(-4), check: { result: 'live' } });
    expect(gemini.sources).toEqual(['LiteLLM litellm.env', 'NewsBites .env']); // the same key twice, merged
    expect(view.keys.find((k) => k.provider === 'groq')?.check?.result).toBe('dead');
    // The demo office already has this OpenAI key saved: merged, not imported twice.
    expect(view.keys.find((k) => k.provider === 'openai')?.savedAs).toBe('OpenAI API');
    expect(view.keys.some((k) => k.variable === 'LITELLM_MASTER_KEY')).toBe(false);
    const toast = events.find((e) => e.type === 'toast' && 'title' in e && String(e.title).startsWith('Keys found'));
    expect(toast).toMatchObject({ actions: ['reviewKeys'] });

    const ceo = await swarm.keyScanForCeo(false);
    expect(ceo).toContain('Google Gemini API');

    const before = swarm.providers.view().connections.length;
    const ids = view.keys.filter((k) => k.importable && k.check?.result === 'live').map((k) => k.id);
    const res = await swarm.importKeys(ids);
    expect(res.imported).toBe(ids.length);
    const after = swarm.providers.view().connections;
    expect(after.length).toBe(before + ids.length);
    // Clean names (#523): the provider's, the variable's own word; the file and variable on a line of their own.
    expect(after.find((c) => c.provider === 'gemini' && c.source)).toMatchObject({ label: 'Google Gemini API', source: 'GEMINI_API_KEY · LiteLLM litellm.env + NewsBites .env', usedFor: 'inference', tags: [] });
    expect(swarm.snapshot().keyScan?.keys.find((k) => k.id === gemini.id)?.savedAs).toBeTruthy();

    const json = JSON.stringify([swarm.snapshot(), events, ceo, res]);
    for (const k of DEMO_FOUND_KEYS) expect(json).not.toContain(k.value);
    // The journal's and logs' redaction knows them while they're in memory.
    const secrets = (swarm as unknown as { secrets(): string[] }).secrets();
    for (const k of DEMO_FOUND_KEYS.filter((k) => k.variable !== 'LITELLM_MASTER_KEY')) expect(secrets).toContain(k.value);
  });

  it('keeps a name, tags and Used for the manager set through a re-scan and its import (#523)', async () => {
    const swarm = new Swarm(createDemoBackend());
    const inside = swarm as unknown as { broadcast(ev: ServerEvent): void; initProviders(): Promise<void> };
    inside.broadcast = () => undefined;
    await inside.initProviders();
    const first = await swarm.scanKeys();
    const paid = first.keys.find((k) => k.variable === 'CEREBRAS_API_KEY_PAID')!;
    await swarm.importKeys([paid.id]);
    const c = swarm.providers.view().connections.find((x) => x.source?.startsWith('CEREBRAS_API_KEY_PAID'))!;
    expect(c).toMatchObject({ label: 'Cerebras (paid)', usedFor: 'inference' });
    await swarm.providers.update(c.id, { label: 'Cerebras paid', tags: 'inference, paid', usedFor: 'both' });

    const again = await swarm.scanKeys();
    expect(again.keys.find((k) => k.variable === 'CEREBRAS_API_KEY_PAID')).toMatchObject({ savedAs: 'Cerebras paid', importable: false });
    await swarm.importKeys(again.keys.map((k) => k.id));
    const now = swarm.providers.view().connections.filter((x) => x.source?.startsWith('CEREBRAS_API_KEY_PAID'));
    expect(now).toEqual([expect.objectContaining({ id: c.id, label: 'Cerebras paid', tags: ['inference', 'paid'], usedFor: 'both', named: true })]);
  });
});
