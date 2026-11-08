import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { inPreviewDesk, nextInLane, owned, ownerText, portBusyText, PreviewPids, stillOurs, type PreviewPid, type ProcInfo } from './previewPids.ts';

// Which processes on a preview port are the office's own (#225): reclaimed when they are, named and left alone when not.

const desks = path.join(os.tmpdir(), 'home', 'workspaces', 'acme__keel', 'desks');
const proc = (over: Partial<ProcInfo> = {}): ProcInfo => ({ pid: 12345, pgid: 12345, command: 'node', startedAt: Date.parse('2026-11-07T11:02:00'), cwd: path.join(desks, 'preview'), ...over });
const entry = (over: Partial<PreviewPid> = {}): PreviewPid => ({ key: 'main:acme/keel', floor: 1, kind: 'main', slot: 0, pid: 12345, pgid: 12345, port: 6301, cwd: path.join(desks, 'preview'), startedAt: Date.parse('2026-11-07T11:02:00'), ...over });

describe('whose process holds a preview port', () => {
  it("is the office's when it runs in one of its preview worktrees", () => {
    expect(owned(proc(), [desks], [])).toBe(true);
    expect(owned(proc({ cwd: path.join(desks, 'preview-pr-2', 'server') }), [desks], [])).toBe(true);
  });

  it("is someone else's anywhere else, even in an agent's desk or a look-alike folder", () => {
    expect(owned(proc({ cwd: path.join(os.tmpdir(), 'elsewhere', 'app') }), [desks], [])).toBe(false);
    expect(owned(proc({ cwd: path.join(desks, 'alan') }), [desks], [])).toBe(false);
    expect(owned(proc({ cwd: path.join(desks, 'previewer') }), [desks], [])).toBe(false);
    expect(owned(proc({ cwd: desks }), [desks], [])).toBe(false);
    expect(inPreviewDesk(path.join(desks, '..', 'main'), [desks])).toBe(false);
  });

  it('goes by the recorded pids where the OS gives no folder (Windows)', () => {
    expect(owned(proc({ cwd: null }), [desks], [entry()])).toBe(true);
    expect(owned(proc({ cwd: null, pid: 999, pgid: 12345 }), [desks], [entry()])).toBe(true); // the app under the recorded shell
    expect(owned(proc({ cwd: null, pid: 999, pgid: 998 }), [desks], [entry()])).toBe(false);
  });

  it('names a holder that is not the office\'s, with pid, program and start time', () => {
    expect(ownerText(proc())).toBe("pid 12345 `node`, started 11:02, not the office's");
    expect(portBusyText(6301, proc())).toBe("Port 6301 is in use by pid 12345 `node`, started 11:02, not the office's. The office won't stop it: use another port, or free this one and try again.");
    expect(portBusyText(6301, null)).toMatch(/^Port 6301 is in use by another program\./);
  });
});

describe('a recorded preview found after a restart', () => {
  it('is reclaimed while it still runs in the worktree it was started in', () => {
    expect(stillOurs(entry(), proc())).toBe(true);
    expect(stillOurs(entry(), proc({ cwd: path.join(desks, 'preview', 'web') }))).toBe(true);
  });

  it('is forgotten once gone, or when its pid now belongs to another program', () => {
    expect(stillOurs(entry(), null)).toBe(false);
    expect(stillOurs(entry(), proc({ cwd: path.join(os.tmpdir(), 'someone', 'else') }))).toBe(false);
  });

  it('without a folder, only when it started when it was recorded', () => {
    expect(stillOurs(entry(), proc({ cwd: null, startedAt: entry().startedAt + 2_000 }))).toBe(true);
    expect(stillOurs(entry(), proc({ cwd: null, startedAt: entry().startedAt + 3_600_000 }))).toBe(false);
    expect(stillOurs(entry(), proc({ cwd: null, startedAt: null }))).toBe(false);
  });
});

describe("a floor's port lane", () => {
  it('picks the next free port, 100 at a time', async () => {
    const busy = new Set([6401, 6501]);
    expect(await nextInLane(6301, (p) => !busy.has(p))).toBe(6601);
    expect(await nextInLane(6301, async () => true)).toBe(6401);
  });

  it('gives up when the lane is full', async () => {
    expect(await nextInLane(6301, () => false)).toBeNull();
  });
});

describe('previews.json', () => {
  it('keeps the recorded processes and the remembered ports for the next run of the office', () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'pids-')), 'previews.json');
    const a = new PreviewPids(file);
    a.record(entry());
    a.record(entry({ pid: 2, port: 6402 }));
    a.drop(2);
    a.setPort('acme/keel', 6401);
    const b = new PreviewPids(file);
    expect(b.entries).toEqual([entry()]);
    expect(b.port('acme/keel')).toBe(6401);
    fs.writeFileSync(file, 'not json');
    expect(new PreviewPids(file).entries).toEqual([]);
  });

  it("keeps a preview's last use across an office restart (#252)", () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'pids-')), 'previews.json');
    const a = new PreviewPids(file);
    a.record(entry({ viewedAt: 1_000_000 }));
    a.used(entry().pid, 2_000_000);
    a.used(entry().pid, 2_005_000); // within 15 s of the last write: not written yet
    expect(new PreviewPids(file).viewedAt(entry().key)).toBe(2_000_000);
    a.used(entry().pid, 2_020_000);
    expect(new PreviewPids(file).viewedAt(entry().key)).toBe(2_020_000);
    expect(new PreviewPids(file).viewedAt('someone/else#main')).toBeNull();
  });
});
