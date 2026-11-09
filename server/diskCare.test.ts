import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { realDisk } from './diskCare.ts';
import { MACHINES_DIR } from './workspace.ts';

// The cleanup removes only inside agents' machines (#340): anything else is refused before a byte goes.

describe('disk cleanup removal', () => {
  it("refuses folders outside the machines' and anything outside the office", async () => {
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'disk-care-'));
    await fs.writeFile(path.join(outside, 'keep.txt'), 'x');
    const item = { id: 'temp:ada:x', kind: 'temp' as const, label: 'x', path: outside, mb: 0, why: '', machine: 'ada' };
    await expect(realDisk.remove(item)).rejects.toThrow(/not the office's to remove/);
    await expect(realDisk.remove({ ...item, kind: 'outside' })).rejects.toThrow(/not the office's to remove/);
    await expect(realDisk.remove({ ...item, path: MACHINES_DIR })).rejects.toThrow(/not the office's to remove/);
    await expect(realDisk.remove({ ...item, path: path.join(MACHINES_DIR, '..', 'state.json') })).rejects.toThrow(/not the office's to remove/);
    expect(await fs.readFile(path.join(outside, 'keep.txt'), 'utf8')).toBe('x');
    await fs.rm(outside, { recursive: true, force: true });
  });

  it('removes a temp folder inside a machine and says how much it freed', async () => {
    const dir = path.join(MACHINES_DIR, 'ada', 'tmp', 'old-home');
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, 'f.bin'), Buffer.alloc(2 * 1024 * 1024));
    const mb = await realDisk.remove({ id: 'temp:ada:old-home', kind: 'temp', label: 'x', path: dir, mb: 0, why: '', machine: 'ada' });
    expect(mb).toBeCloseTo(2, 1);
    await expect(fs.stat(dir)).rejects.toThrow();
  });
});
