// The design system's ratchet (docs/design.md, "Use tokens"): colour literals in the old stylesheets may only go down.
// New rules use design.css's tokens; when a cleanup removes literals, lower the number here.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = path.dirname(fileURLToPath(import.meta.url));
const CEILING: Record<string, number> = {
  'styles.css': 291,
  'pocket/pocket.css': 0,
  'ui/games/games.css': 10,
  'ui/timelapse.css': 13,
  'ui/costs.css': 2,
  'ui/chatRefs.css': 6,
  'ui/experiments.css': 14,
  'ui/finder.css': 0,
  'ui/details.css': 0,
};

/** Hex colours and rgb()/rgba() calls, comments left out. */
const colourLiterals = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '').match(/#[0-9a-f]{3,8}\b|rgba?\(/gi)?.length ?? 0;

describe('stylesheets use design tokens', () => {
  it('counts literals, not comments', () => {
    expect(colourLiterals('a { color: #fff; background: rgba(0, 0, 0, 0.1); } /* #123456 */ b { color: var(--ds-text); }')).toBe(2);
  });
  for (const [file, max] of Object.entries(CEILING)) {
    it(`${file} has no new colour literals`, () => {
      expect(colourLiterals(fs.readFileSync(path.join(here, file), 'utf8'))).toBeLessThanOrEqual(max);
    });
  }
});

/** `z-index` values over 10 written as numbers, comments left out: they belong on design.css's layer tokens (#212). */
const rawLayers = (css: string) => [...css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/z-index:\s*(-?\d+)\s*[;}]/g)].map((m) => Number(m[1])).filter((n) => n > 10);

const stylesheets = (dir: string): string[] =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? stylesheets(path.join(dir, e.name)) : e.name.endsWith('.css') ? [path.join(dir, e.name)] : []));

describe('one stacking scale (#212)', () => {
  it('finds raw layers, not tokens or small local ones', () => {
    expect(rawLayers('a { z-index: 30; } b { z-index: var(--ds-z-panel); } c { z-index: 2; } d { z-index: calc(var(--ds-z-base) + 1); } /* z-index: 99; */ e{z-index:1000}')).toEqual([30, 1000]);
  });
  for (const file of stylesheets(here)) {
    it(`${path.relative(here, file).replace(/\\/g, '/')} layers on the tokens`, () => {
      expect(rawLayers(fs.readFileSync(file, 'utf8'))).toEqual([]);
    });
  }
});
