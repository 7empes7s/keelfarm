import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Appender, claudeProjectsDir, dailyLogDir, findTranscript, historyFilter, projectFolder, SessionHistory } from './history.ts';
import { readTranscript, type HistoryEntry } from '../shared/history.ts';
import { createDemoBackend } from './demo.ts';
import { HOME_DIR } from './config.ts';

const AT = Date.UTC(2026, 10, 5, 5, 40);
const DAY = 86_400_000;
let tmp: string;

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'history-'));
});
afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

const entry = (o: Partial<HistoryEntry> = {}): HistoryEntry => ({
  id: `e${o.at ?? AT}`,
  at: AT,
  startedAt: AT - 60_000,
  repoId: 'r1',
  repo: 'o/r',
  floor: 1,
  agentId: 'a1',
  agent: 'Grace',
  kind: 'qa',
  issue: 41,
  pr: 63,
  title: 'A title',
  outcome: 'qa-pass',
  note: '',
  usd: 0.5,
  tokens: null,
  model: 'm',
  effort: 'low',
  sessionId: 'sess-1',
  transcript: null,
  ...o,
});

describe('where things go', () => {
  it("writes the daily log to the setting, else the machine's folder, else the office's home; the demo only ever to its own home", () => {
    const home = path.join(tmp, 'home');
    expect(dailyLogDir('', { demo: false, home, machineDir: '/opt/ai-vault/daily' })).toBe('/opt/ai-vault/daily');
    expect(dailyLogDir('', { demo: false, home, machineDir: null })).toBe(path.join(home, 'daily'));
    expect(dailyLogDir(' /var/log/work ', { demo: false, home, machineDir: '/opt/ai-vault/daily' })).toBe(path.resolve('/var/log/work'));
    expect(dailyLogDir('/opt/ai-vault/daily', { demo: true, home, machineDir: '/opt/ai-vault/daily' })).toBe(path.join(home, 'demo-daily'));
  });

  it("finds Claude Code's transcripts under CLAUDE_CONFIG_DIR, else ~/.claude", () => {
    expect(claudeProjectsDir({ CLAUDE_CONFIG_DIR: '/c' }, '/home/u')).toBe(path.join('/c', 'projects'));
    expect(claudeProjectsDir({}, '/home/u')).toBe(path.join('/home/u', '.claude', 'projects'));
  });
});

describe('transcript discovery', () => {
  it("names a worktree's folder the way Claude Code does, on Linux and Windows", () => {
    expect(projectFolder('/root/.cubefarm/machines/0364fd0b/work/7empes7s__keelfarm')).toBe('-root--cubefarm-machines-0364fd0b-work-7empes7s--keelfarm');
    expect(projectFolder('C:\\Users\\Ada Lovelace\\.cubefarm\\work\\o__r')).toBe('C--Users-Ada-Lovelace--cubefarm-work-o--r');
  });

  it('finds the session in its worktree folder, else in any project folder, never outside', async () => {
    const projects = path.join(tmp, 'projects');
    const cwd = path.join(tmp, 'machines', 'm1', 'work', 'o__r');
    const direct = path.join(projects, projectFolder(cwd), 'abc.jsonl');
    await fs.mkdir(path.dirname(direct), { recursive: true });
    await fs.writeFile(direct, '{}\n');
    expect(await findTranscript(projects, cwd, 'abc')).toBe(direct);

    const moved = path.join(projects, 'some-other-folder', 'def.jsonl');
    await fs.mkdir(path.dirname(moved), { recursive: true });
    await fs.writeFile(moved, '{}\n');
    expect(await findTranscript(projects, cwd, 'def')).toBe(moved);
    expect(await findTranscript(projects, cwd, 'missing')).toBeNull();
    expect(await findTranscript(projects, cwd, '../../etc/passwd')).toBeNull();
    expect(await findTranscript(path.join(tmp, 'nowhere'), cwd, 'abc')).toBeNull();
  });
});

describe("the demo's transcripts", () => {
  it('are made up inside its own home, never elsewhere, and read back', async () => {
    const t = await createDemoBackend().sessionTranscript('/anywhere', null, { agent: 'Ada', kind: 'qa', title: 'PR #3 Add socks', at: AT });
    expect(path.relative(HOME_DIR, t!.file).startsWith('..')).toBe(false);
    const { items } = readTranscript(await fs.readFile(t!.file, 'utf8'), []);
    expect(items[0]).toMatchObject({ role: 'user', text: 'Test PR #3 Add socks (demo).' });
    expect(items.some((i) => i.role === 'tool' && i.tool === 'Bash')).toBe(true);
  });
});

describe('appends', () => {
  it('never interleaves entries from concurrent writers', async () => {
    const file = path.join(tmp, 'daily', '2026-11-05.md');
    const writers = [new Appender(), new Appender()]; // two writers on the same file, e.g. two offices' tabs of state
    const block = (i: number) => `### entry ${i}\n${`- line of entry ${i}\n`.repeat(40)}\n`;
    await Promise.all(Array.from({ length: 60 }, (_, i) => writers[i % 2].append(file, async () => (await new Promise((r) => setTimeout(r, i % 3)), block(i)))));
    const text = await fs.readFile(file, 'utf8');
    const blocks = text.split(/(?=### entry )/);
    expect(blocks).toHaveLength(60);
    for (const b of blocks) expect(b).toBe(block(Number(b.match(/^### entry (\d+)/)![1])));
  });
});

describe('the session history', () => {
  const make = (now = AT) => {
    const daily = path.join(tmp, 'daily');
    return new SessionHistory({ dir: path.join(tmp, 'history'), dailyDir: () => daily, secrets: () => ['planted-secret-value'], now: () => now });
  };

  it('keeps a gzipped copy of the transcript, indexes the entry and appends it to the day under one heading', async () => {
    const source = path.join(tmp, 'src.jsonl');
    const transcript = `${JSON.stringify({ type: 'user', message: { role: 'user', content: 'Test PR #63 planted-secret-value' } })}\n`;
    await fs.writeFile(source, transcript);
    const h = make();
    const kept = await h.record(entry(), source);
    await h.record(entry({ id: 'e2', at: AT + 1000, sessionId: null, outcome: 'qa-fail', note: 'broke planted-secret-value' }), null);
    expect(kept.transcript).toBe('2026/11/05/grace-qa-sess-1.jsonl.gz');
    expect(zlib.gunzipSync(await fs.readFile(h.file(kept.transcript!))).toString()).toBe(transcript);

    const day = await fs.readFile(path.join(tmp, 'daily', '2026-11-05.md'), 'utf8');
    expect(day.match(/## cubefarm office · 2026-11-05/g)).toHaveLength(1);
    expect(day).toContain(`- Transcript: ${h.file(kept.transcript!)}`);
    expect(day).not.toContain('planted-secret-value');

    const again = make();
    await again.load();
    expect(again.all().map((e) => e.id)).toEqual([kept.id, 'e2']);
    const detail = await again.detail(kept.id);
    expect(detail?.transcript).toEqual([{ role: 'user', text: 'Test PR #63 [redacted]', at: undefined }]);
    expect(await again.detail('nope')).toBeNull();
    expect((await again.detail('e2'))?.transcript).toBeNull();
    expect(await again.usage()).toMatchObject({ files: 1, sessions: 2, dailyDir: path.join(tmp, 'daily') });
    await fs.rm(h.file(kept.transcript!));
    expect((await again.detail(kept.id))?.transcript).toBeNull(); // the copy went missing: the summary still opens
  });

  it("adds the office's heading after someone else's notes in the same day file", async () => {
    const file = path.join(tmp, 'daily', '2026-11-05.md');
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, '# 2026-11-05\n- deployed KEEL\n');
    await make().record(entry({ sessionId: null }), null);
    expect(await fs.readFile(file, 'utf8')).toMatch(/^# 2026-11-05\n- deployed KEEL\n\n## cubefarm office · 2026-11-05 \(UTC\)\n\n### /);
  });

  it('sweeps: old entries and day folders go, finished days get their totals once', async () => {
    const h = make(AT - 100 * DAY);
    await fs.writeFile(path.join(tmp, 'old.jsonl'), '{}\n');
    await h.record(entry({ id: 'old', at: AT - 100 * DAY }), path.join(tmp, 'old.jsonl'));
    const later = make(AT);
    await later.load();
    await later.record(entry({ id: 'yesterday', at: AT - DAY, sessionId: null }), null);
    await later.record(entry({ id: 'today', sessionId: null }), null);
    await later.sweep(90, '5h 42%');
    await later.sweep(90, '5h 42%');
    expect(later.all().map((e) => e.id)).toEqual(['yesterday', 'today']);
    await expect(fs.stat(path.join(tmp, 'history', '2026', '07'))).resolves.toBeTruthy(); // the month folder may stay
    await expect(fs.readdir(path.join(tmp, 'history', '2026', '07'))).resolves.toEqual([]);
    const yesterday = await fs.readFile(path.join(tmp, 'daily', '2026-11-04.md'), 'utf8');
    expect(yesterday.match(/### cubefarm totals · 2026-11-04/g)).toHaveLength(1);
    expect(yesterday).toContain('usage at end of day: 5h 42%');
    await expect(fs.readFile(path.join(tmp, 'daily', '2026-11-05.md'), 'utf8')).resolves.not.toContain('totals');

    const reloaded = make(AT);
    await reloaded.load();
    expect(reloaded.all().map((e) => e.id)).toEqual(['yesterday', 'today']);
    await reloaded.sweep(0, null); // forever: nothing goes, and yesterday isn't totalled again
    expect((await fs.readFile(path.join(tmp, 'daily', '2026-11-04.md'), 'utf8')).match(/totals/g)).toHaveLength(1);
  });
});

describe("the History screen's query", () => {
  it('reads filters from the query string, ignoring junk', () => {
    expect(historyFilter({ repo: 'o/r', agent: ' Grace ', kind: 'qa', pr: '63', issue: 'x', offset: '25', q: '' })).toEqual({
      repoId: 'o/r',
      agent: 'Grace',
      kind: 'qa',
      outcome: undefined,
      q: undefined,
      issue: undefined,
      pr: 63,
      since: undefined,
      until: undefined,
      offset: 25,
      limit: undefined,
    });
  });
});
