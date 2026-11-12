import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { MODELS, fitModel, modelUrl } from './registry';

const DIR = path.join(__dirname, '..', '..', '..', 'public', 'models');
const glbs = (dir: string): string[] =>
  readdirSync(dir).flatMap((f) => {
    const p = path.join(dir, f);
    return statSync(p).isDirectory() ? glbs(p).map((g) => `${f}/${g}`) : f.endsWith('.glb') ? [f] : [];
  });

describe('the model registry', () => {
  const licences = readFileSync(path.join(DIR, 'LICENSES.md'), 'utf8');
  const rows = new Map(
    licences
      .split('\n')
      .map((l) => l.split('|').map((c) => c.trim().replace(/`/g, '')))
      .filter((c) => c.length > 4 && c[1].endsWith('.glb'))
      .map((c) => [c[1], { source: c[2], licence: c[3] }]),
  );

  it('lists every model file in LICENSES.md as CC0, with its source', () => {
    for (const m of Object.values(MODELS)) {
      const row = rows.get(m.file);
      expect(row, m.file).toBeDefined();
      expect(row!.licence, m.file).toBe('CC0');
      expect(row!.source, m.file).toMatch(/^https:\/\//);
    }
  });

  it('has a registry entry for every file in public/models, and a file for every entry', () => {
    const files = glbs(DIR).sort();
    expect(files).toEqual(Object.values(MODELS).map((m) => m.file).sort());
    expect([...rows.keys()].sort()).toEqual(files);
  });

  it('keeps the models small', () => {
    const total = glbs(DIR).reduce((n, f) => n + statSync(path.join(DIR, f)).size, 0);
    expect(total).toBeLessThan(3 * 1024 * 1024);
  });

  it("serves a model from the app's base path", () => {
    expect(modelUrl('plant', '/')).toBe(`/models/${MODELS.plant.file}`);
    expect(modelUrl('plant', '/preview/6301/')).toBe(`/preview/6301/models/${MODELS.plant.file}`);
  });
});

describe('fitModel', () => {
  it('scales a model into its box, centred on x and z, standing on the floor', () => {
    // Kenney's models sit off-centre and small: a 0.4 x 0.85 x 0.25 cabinet from (-0.16, 0, -0.25)
    const f = fitModel({ min: [-0.16, 0, -0.25], max: [0.24, 0.85, 0] }, [0.8, 1.7, 0.5]);
    expect(f.scale).toEqual([2, 2, 2].map((n) => expect.closeTo(n)));
    expect(f.offset[0]).toBeCloseTo(-0.04 * 2);
    expect(f.offset[1]).toBeCloseTo(0);
    expect(f.offset[2]).toBeCloseTo(0.125 * 2);
  });

  it('keeps proportions, fitting the tightest side', () => {
    const f = fitModel({ min: [0, 0, 0], max: [1, 1, 1] }, [2, 0.5, 2]);
    expect(f.scale).toEqual([0.5, 0.5, 0.5]);
  });

  it('stretches to fill the box on every axis when asked, so a table top lands at its height (#536)', () => {
    const f = fitModel({ min: [0, 0, -0.45], max: [0.84, 0.33, 0] }, [1.2, 0.75, 0.75], true);
    expect(f.scale.map((n) => n.toFixed(3))).toEqual([(1.2 / 0.84).toFixed(3), (0.75 / 0.33).toFixed(3), (0.75 / 0.45).toFixed(3)]);
    expect(f.offset[0]).toBeCloseTo(-0.42 * (1.2 / 0.84));
    expect(f.offset[1]).toBeCloseTo(0);
    expect(f.offset[2]).toBeCloseTo(0.225 * (0.75 / 0.45));
  });
});
