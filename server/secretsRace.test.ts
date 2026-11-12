import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { expect, it, vi } from 'vitest';

// Two test workers (or two offices) write the same demo secrets file: each has its own write queue, so their temp
// files must not share a name, or one's rename finds the other's already gone (ENOENT).
it('merges into one file from two separate queues at once without losing a rename', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'secrets-race-'));
  const file = path.join(dir, 'demo-telegram-secrets.json');
  const a = await import('./secrets.ts');
  vi.resetModules();
  const b = await import('./secrets.ts');
  expect(a.mergeSecrets).not.toBe(b.mergeSecrets);
  const writes = Array.from({ length: 40 }, (_, i) => (i % 2 ? a : b).mergeSecrets(file, { [`k${i % 4}`]: i }));
  await expect(Promise.all(writes)).resolves.toBeDefined();
  expect(Object.keys(await a.readSecrets(file)).length).toBeGreaterThan(0);
  await fs.rm(dir, { recursive: true, force: true });
});
