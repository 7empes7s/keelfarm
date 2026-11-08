import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ACTION_IDS } from './keymap';
import { TOUR, isStep, markSeen, newSince, seenIds, stepsFor, textParts, trackFor, whatsNew, type Track } from './tourSteps';

const here = path.dirname(fileURLToPath(import.meta.url));
const src = path.join(here, '..');
const steps = TOUR.filter(isStep);

/** Every `data-tour="…"` in the client's components: the controls a step can point at. */
function tourTargets(): Set<string> {
  const found = new Set<string>();
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.tsx') && !e.name.endsWith('.test.tsx'))
        // data-tour="x", or data-tour={k === 'chat' ? 'chat' : undefined}: its last quoted word
        for (const m of fs.readFileSync(p, 'utf8').matchAll(/data-tour=(?:"([a-z-]+)"|\{[^}]*'([a-z-]+)'[^}']*\})/g)) found.add(m[1] ?? m[2]);
    }
  };
  walk(src);
  return found;
}

describe('the tour', () => {
  it('has unique ids, one sentence per step and versions from 1', () => {
    const ids = TOUR.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const s of steps) {
      for (const t of [s.text, s.touchText ?? '']) expect(t.replace(/\{[^}]+\}/g, 'x').split(/[.!?](\s|$)/).filter((x) => x?.trim()).length, s.id).toBeLessThanOrEqual(2);
      expect(s.added).toBeGreaterThanOrEqual(1);
      expect(s.tracks.length).toBeGreaterThan(0);
    }
  });

  it('points every step at a control that exists in the office', () => {
    const targets = tourTargets();
    const missing = steps.flatMap((s) => (s.targets ?? []).filter((t) => !targets.has(t)).map((t) => `${s.id} → ${t}`));
    expect(missing).toEqual([]);
  });

  it('only uses key bindings that exist', () => {
    for (const s of steps) for (const p of textParts(s.text)) if ('key' in p) expect(ACTION_IDS, s.id).toContain(p.key);
  });

  it("is listed in docs/pocket.md, step by step", () => {
    const docs = fs.readFileSync(path.join(here, '../../../docs/pocket.md'), 'utf8');
    for (const s of steps) expect(docs, s.id).toContain(`\`${s.id}\``);
  });

  it('covers every merged feature on every track, and keeps hooks for the rest', () => {
    for (const track of ['phone', 'desk', 'office'] as Track[]) {
      const ids = stepsFor(track).map((s) => s.id);
      expect(ids).toEqual(expect.arrayContaining(['search', 'guide', 'bell', 'chat-cards', 'console', 'charter', 'costs', 'agent-chat']));
    }
    expect(stepsFor('desk').map((s) => s.id)).toContain('desk-keys');
    expect(stepsFor('office').map((s) => s.id)).toContain('switch');
    expect(TOUR.filter((e) => !isStep(e)).map((e) => ('hook' in e ? e.hook : 0))).toEqual([115, 117, 114, 118]);
    expect(stepsFor('phone').some((s) => s.id.startsWith('memory'))).toBe(false); // hooks never show
  });

  it('picks the track from the mode and layout', () => {
    expect(trackFor('office', 'compact')).toBe('office');
    expect(trackFor('pocket', 'compact')).toBe('phone');
    expect(trackFor('pocket', 'medium')).toBe('desk');
    expect(trackFor('pocket', 'expanded')).toBe('desk');
  });
});

describe("what's new", () => {
  it('replays only the steps added since this device finished the tour', () => {
    const all = stepsFor('office');
    const seen = all.filter((s) => s.id !== 'bell' && s.id !== 'costs').map((s) => s.id);
    expect(newSince('office', seen).map((s) => s.id)).toEqual(['bell', 'costs']);
    expect(newSince('office', markSeen(seen, all))).toEqual([]);
  });

  it('treats a device that finished the old tour as having seen just it', () => {
    const seen = seenIds(null, true);
    expect(seen).toContain('look');
    expect(seen).not.toContain('bell');
    expect(newSince('office', seen).map((s) => s.id)).toEqual(['bell', 'chat-cards', 'console', 'charter', 'costs', 'agent-chat', 'chat-full', 'chat-charts', 'switch']);
    expect(seenIds(null, false)).toEqual([]); // mid-tour: nothing seen yet
    expect(seenIds('["bell"]', true)).toEqual(['bell']);
    expect(seenIds('not json', true)).toContain('look');
  });

  it('asked for again with nothing new, replays the newest additions', () => {
    const all = stepsFor('phone').map((s) => s.id);
    const newest = Math.max(...stepsFor('phone').map((s) => s.added));
    expect(whatsNew('phone', all).every((s) => s.added === newest)).toBe(true);
    expect(whatsNew('phone', all.filter((id) => id !== 'bell')).map((s) => s.id)).toEqual(['bell']);
  });

  it('splits a step into words, keys and names', () => {
    expect(textParts('Press {key:phone} to text {ceo}, walk with {move}.')).toEqual([{ text: 'Press ' }, { key: 'phone' }, { text: ' to text ' }, { name: 'ceo' }, { text: ', walk with ' }, { move: true }, { text: '.' }]);
  });
});
