import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { SECTIONS } from './consoleNavRules';
import { EMPTY } from './emptyStates';
import { SCREEN_HELP } from './screenHelp';

const here = path.dirname(fileURLToPath(import.meta.url));

describe('what can I do here', () => {
  it('has a sheet for every console section and pocket tab', () => {
    for (const id of [...SECTIONS.map((s) => s.id), 'company', 'kanban', 'pocket-team', 'approvals'] as const) {
      const h = SCREEN_HELP[id];
      expect(h, id).toBeTruthy();
      expect(h.shows.length, id).toBeGreaterThan(20);
      expect(h.actions, id).toHaveLength(3);
      expect(h.docs, id).toMatch(/^https:\/\/github\.com\/.+\/docs\/.+\.md/);
    }
  });

  it('links to docs files that exist', () => {
    for (const h of Object.values(SCREEN_HELP)) {
      const file = h.docs.match(/\/docs\/([\w/-]+\.md)/)![1];
      expect(fs.existsSync(path.join(here, '../../../docs', file)), file).toBe(true);
    }
  });
});

describe('empty states', () => {
  it('each say what would appear, why it is empty and what to do next', () => {
    for (const [kind, e] of Object.entries(EMPTY)) {
      expect(e.what.length, kind).toBeGreaterThan(15);
      expect(e.why.length, kind).toBeGreaterThan(10);
      expect(e.action.label.length, kind).toBeGreaterThan(3);
      expect(e.what, kind).not.toMatch(/^nothing here/i);
    }
  });
});
