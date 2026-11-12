import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { MODEL_FILES } from './glb';

// Every 3D model the office ships is CC0 (#536): each file in client/public/models has a CC0 row in its LICENSES.md,
// and every model the props ask for is there.

const DIR = path.join(__dirname, '..', '..', '..', 'public', 'models');
const files = (dir: string, rel = ''): string[] =>
  readdirSync(path.join(dir, rel), { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(dir, path.posix.join(rel, e.name)) : [path.posix.join(rel, e.name)]));

describe('3D model licences', () => {
  const rows = new Map(
    readFileSync(path.join(DIR, 'LICENSES.md'), 'utf8')
      .split('\n')
      .filter((l) => l.startsWith('| ') && !l.startsWith('| File') && !l.startsWith('| ---'))
      .map((l) => l.split('|').map((c) => c.trim()))
      .map((c) => [c[1], c[5]] as const),
  );

  it('lists every model file as CC0', () => {
    const models = files(DIR).filter((f) => f !== 'LICENSES.md');
    expect(models.length).toBeGreaterThan(0);
    for (const f of models) {
      expect(f.endsWith('.glb'), f).toBe(true);
      expect(rows.get(f), f).toBe('CC0');
    }
  });

  it('has every model the props load, small enough to download on a phone', () => {
    const models = new Set(files(DIR));
    for (const f of Object.values(MODEL_FILES)) {
      expect(models.has(f), f).toBe(true);
      expect(readFileSync(path.join(DIR, f)).length, f).toBeLessThan(64 * 1024);
    }
  });
});
