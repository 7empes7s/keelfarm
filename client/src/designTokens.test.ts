// The design system's ratchet (docs/design.md, "Use tokens"): colour literals in the old stylesheets may only go down.
// New rules use design.css's tokens; when a cleanup removes literals, lower the number here.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = path.dirname(fileURLToPath(import.meta.url));
const CEILING: Record<string, number> = {
  'styles.css': 294,
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
