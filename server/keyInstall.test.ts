import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { installKeyFile, restoreKeyFile } from './keyInstall.ts';
import { secretPath } from './itDesk.ts';

describe('install_key writes a service env file (#609)', () => {
  it('sets the value, keeps the other lines, mode 600, keeps a backup, and undoes', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'keyinstall-'));
    const file = path.join(dir, 'clipfarm.env');
    await fs.writeFile(file, 'PORT=8080\nOPENAI_API_KEY=old\n# keep me\n', { mode: 0o644 });
    const { backup } = await installKeyFile(file, 'OPENAI_API_KEY', 'sk-live-value-ab12', '20261112120000');
    expect(await fs.readFile(file, 'utf8')).toBe('PORT=8080\nOPENAI_API_KEY=sk-live-value-ab12\n# keep me\n');
    expect(backup).toBe(path.join(dir, 'clipfarm.20261112120000.bak.env'));
    expect(await fs.readFile(backup!, 'utf8')).toBe('PORT=8080\nOPENAI_API_KEY=old\n# keep me\n');
    expect(secretPath(backup!)).toBe(true); // the IT desk's never-list covers the backup too
    if (process.platform !== 'win32') {
      expect((await fs.stat(file)).mode & 0o777).toBe(0o600);
      expect((await fs.stat(backup!)).mode & 0o777).toBe(0o600);
    }
    await restoreKeyFile(file, backup);
    expect(await fs.readFile(file, 'utf8')).toBe('PORT=8080\nOPENAI_API_KEY=old\n# keep me\n');
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('makes the file when there was none (its undo removes it), and keeps 5 backups', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'keyinstall-'));
    const file = path.join(dir, 'svc.env');
    expect((await installKeyFile(file, 'A', '1', '20260101000000')).backup).toBeNull();
    expect(await fs.readFile(file, 'utf8')).toBe('A=1\n');
    for (let i = 1; i <= 7; i++) await installKeyFile(file, 'A', String(i), `2026010100000${i}`);
    expect((await fs.readdir(dir)).filter((f) => f.endsWith('.bak.env'))).toHaveLength(5);
    await restoreKeyFile(file, null);
    await expect(fs.stat(file)).rejects.toThrow();
    await fs.rm(dir, { recursive: true, force: true });
  });
});
