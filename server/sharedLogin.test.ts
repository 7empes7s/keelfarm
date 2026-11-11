import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { keptName, newLines, shareLogin, shareStatus, SHARED_ITEMS, unshareLogin } from './sharedLogin.ts';

// One shared set for every Claude login (#377), in temp folders only: `source` stands in for ~/.claude.

const temps: string[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const d of temps.splice(0)) fs.rmSync(d, { recursive: true, force: true, maxRetries: 5 });
});

function setup() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cf-share-'));
  temps.push(root);
  const source = path.join(root, 'builtin');
  const write = (file: string, text: string) => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
  };
  write(path.join(source, 'projects', '-root', 'memory', 'MEMORY.md'), '- [a](a.md)\n');
  write(path.join(source, 'projects', '-root', 'memory', 'a.md'), 'A\n');
  write(path.join(source, 'CLAUDE.md'), '# mine\n');
  write(path.join(source, 'skills', 'deploy', 'SKILL.md'), 'deploy\n');
  for (const d of ['agents', 'commands', 'plugins']) fs.mkdirSync(path.join(source, d));
  write(path.join(source, 'settings.json'), '{"model":"opus"}\n');
  write(path.join(source, 'history.jsonl'), '{"display":"one"}\n');
  write(path.join(source, '.credentials.json'), '{"builtin":true}');
  const dir = (id: string) => path.join(root, 'accounts', id, 'claude');
  return { root, source, dir, write };
}

const read = (f: string) => fs.readFileSync(f, 'utf8');

describe('shareLogin', () => {
  it('links every shared item into an account folder and keeps its credentials and .claude.json its own', () => {
    const { source, dir, write } = setup();
    const a = dir('claude-pro');
    write(path.join(a, '.credentials.json'), '{"pro":true}');
    write(path.join(a, '.claude.json'), '{"hasCompletedOnboarding":true}');
    const r = shareLogin(a, source, 'claude-pro');
    expect(r.linked.sort()).toEqual(SHARED_ITEMS.map((i) => i.name).sort());
    expect(r.missing).toEqual([]);
    expect(fs.realpathSync(path.join(a, 'projects'))).toBe(fs.realpathSync(path.join(source, 'projects')));
    expect(read(path.join(a, 'projects', '-root', 'memory', 'a.md'))).toBe('A\n'); // the memory is there
    expect(read(path.join(a, 'skills', 'deploy', 'SKILL.md'))).toBe('deploy\n');
    expect(read(path.join(a, '.credentials.json'))).toBe('{"pro":true}');
    expect(read(path.join(a, '.claude.json'))).toBe('{"hasCompletedOnboarding":true}');
    expect(read(path.join(source, '.credentials.json'))).toBe('{"builtin":true}');
    expect(fs.existsSync(path.join(source, '.claude.json'))).toBe(false);
  });

  it('a conversation written under one account resumes under another: the same transcript by the same session id', () => {
    const { source, dir } = setup();
    shareLogin(dir('a'), source, 'a');
    shareLogin(dir('b'), source, 'b');
    const transcript = (d: string) => path.join(d, 'projects', '-root-ceo', 'f0e1d2c3-session.jsonl');
    fs.mkdirSync(path.dirname(transcript(dir('a'))), { recursive: true });
    fs.appendFileSync(transcript(dir('a')), '{"type":"user","message":"hello"}\n');
    expect(read(transcript(dir('b')))).toBe('{"type":"user","message":"hello"}\n');
    fs.appendFileSync(transcript(dir('b')), '{"type":"assistant"}\n'); // and back
    expect(read(transcript(source)).split('\n').filter(Boolean)).toHaveLength(2);
  });

  it('merges what an account already had into the shared set first, losing nothing', () => {
    const { source, dir, write } = setup();
    const a = dir('claude-rvuese');
    write(path.join(a, 'settings.json'), '{"model":"sonnet"}\n'); // differs: kept beside the shared one
    write(path.join(a, 'history.jsonl'), '{"display":"one"}\n{"display":"two"}\n'); // new lines appended
    write(path.join(a, 'projects', '-root', 'memory', 'pro-only.md'), 'P\n'); // only here: moved over
    write(path.join(a, 'projects', '-root', 'memory', 'a.md'), 'A\n'); // the same bytes: one copy
    write(path.join(a, 'projects', '-root', 'memory', 'MEMORY.md'), '- [p](pro-only.md)\n'); // differs
    write(path.join(a, 'commands', 'ship.md'), 'ship\n');
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const r = shareLogin(a, source, 'claude-rvuese');
    expect(r.missing).toEqual([]);
    expect(read(path.join(source, 'settings.json'))).toBe('{"model":"opus"}\n'); // the user's own file untouched
    expect(read(path.join(source, 'settings.json.from-claude-rvuese'))).toBe('{"model":"sonnet"}\n');
    expect(read(path.join(source, 'history.jsonl'))).toBe('{"display":"one"}\n{"display":"two"}\n');
    const mem = path.join(source, 'projects', '-root', 'memory');
    expect(fs.readdirSync(mem).sort()).toEqual(['MEMORY.md', 'MEMORY.md.from-claude-rvuese', 'a.md', 'pro-only.md']);
    expect(read(path.join(mem, 'MEMORY.md'))).toBe('- [a](a.md)\n');
    expect(read(path.join(source, 'commands', 'ship.md'))).toBe('ship\n');
    expect(r.moved.length).toBeGreaterThanOrEqual(5);
    // Through the account's folder it all reads the same now.
    expect(read(path.join(a, 'projects', '-root', 'memory', 'pro-only.md'))).toBe('P\n');
    expect(read(path.join(a, 'history.jsonl'))).toBe(read(path.join(source, 'history.jsonl')));
  });

  it('runs again safely, and heals a broken or replaced link', () => {
    const { source, dir, root } = setup();
    const a = dir('x');
    shareLogin(a, source, 'x');
    expect(shareLogin(a, source, 'x')).toEqual({ linked: [], moved: [], missing: [] });
    const elsewhere = path.join(root, 'elsewhere');
    fs.mkdirSync(elsewhere);
    fs.unlinkSync(path.join(a, 'skills'));
    fs.symlinkSync(elsewhere, path.join(a, 'skills'), 'junction'); // replaced
    fs.unlinkSync(path.join(a, 'agents'));
    fs.symlinkSync(path.join(root, 'gone'), path.join(a, 'agents'), 'junction'); // broken
    fs.unlinkSync(path.join(a, 'CLAUDE.md')); // missing
    expect(shareStatus(a, source).sort()).toEqual(['CLAUDE.md', 'agents', 'skills']);
    const r = shareLogin(a, source, 'x');
    expect(r.linked.sort()).toEqual(['CLAUDE.md', 'agents', 'skills']);
    expect(r.missing).toEqual([]);
    expect(fs.existsSync(elsewhere)).toBe(true); // a link taken away, never its target
  });

  it('an item the shared set lacks but the account has becomes the shared one; one neither has is skipped', () => {
    const { source, dir, write } = setup();
    fs.rmSync(path.join(source, 'CLAUDE.md'));
    fs.rmSync(path.join(source, 'agents'), { recursive: true });
    const a = dir('y');
    write(path.join(a, 'CLAUDE.md'), '# from y\n');
    const r = shareLogin(a, source, 'y');
    expect(read(path.join(source, 'CLAUDE.md'))).toBe('# from y\n');
    expect(r.linked).toContain('CLAUDE.md');
    expect(r.linked).not.toContain('agents');
    expect(fs.existsSync(path.join(source, 'agents'))).toBe(false);
  });

  it("does nothing without a shared set, and removing an account's links leaves the shared set whole", () => {
    const { source, dir, root } = setup();
    expect(shareLogin(dir('z'), path.join(root, 'nowhere'), 'z')).toEqual({ linked: [], moved: [], missing: [] });
    shareLogin(dir('z'), source, 'z');
    unshareLogin(dir('z'));
    fs.rmSync(path.join(root, 'accounts', 'z'), { recursive: true, force: true });
    expect(read(path.join(source, 'projects', '-root', 'memory', 'a.md'))).toBe('A\n');
    expect(read(path.join(source, 'settings.json'))).toBe('{"model":"opus"}\n');
  });
});

describe('merge rules', () => {
  it('newLines: only the lines the shared history lacks, in order', () => {
    expect(newLines('a\nb\n', 'b\nc\n\nd')).toEqual(['c', 'd']);
  });
  it('keptName: <name>.from-<account>, numbered when taken', () => {
    const taken = new Set(['s.json.from-pro', 's.json.from-pro-2']);
    expect(keptName('s.json', 'max', (n) => taken.has(n))).toBe('s.json.from-max');
    expect(keptName('s.json', 'pro', (n) => taken.has(n))).toBe('s.json.from-pro-3');
  });
});
