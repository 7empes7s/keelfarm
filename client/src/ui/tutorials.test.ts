import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseRoute } from '../routes';
import { doneOf, moveTo, neverStarted, NO_PROGRESS, pauseTutorial, pickAgent, pickPr, readProgress, sentCount, startTutorial, stepBlocked, stepLink, tapUses, TUTORIALS, type World } from './tutorials';

const here = path.dirname(fileURLToPath(import.meta.url));

/** Every client component's source, to find the controls a step rings. */
function sources(): string {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.tsx') && !e.name.endsWith('.test.tsx')) out.push(fs.readFileSync(p, 'utf8'));
    }
  };
  walk(path.join(here, '..'));
  return out.join('\n');
}

/** Whether a selector names something the client renders: a data-tour, an id or a class in its JSX. */
function rendered(sel: string, src: string): boolean {
  const tour = /^\[data-tour="([a-z-]+)"\]$/.exec(sel)?.[1];
  if (tour) {
    const [prefix, col] = tour.split(/-(?=[a-z]+$)/);
    return src.includes(`data-tour="${tour}"`) || src.includes(`tour="${tour}"`) || (prefix === 'kanban' && src.includes('data-tour={`kanban-${id}`}') && src.includes(`'${col}',`));
  }
  if (sel.startsWith('#')) return src.includes(`id="${sel.slice(1)}"`);
  if (sel.startsWith('.')) return new RegExp(`className=[{"\`][^>]*\\b${sel.slice(1)}\\b`).test(src);
  return false;
}

const world: World = {
  repos: [
    { id: 'b', floor: 2, pulls: [{ number: 7, state: 'OPEN' } as never] },
    { id: 'a', floor: 1, pulls: [{ number: 3, state: 'OPEN' } as never, { number: 4, state: 'OPEN' } as never, { number: 5, state: 'MERGED' } as never] },
  ],
  agents: {
    ceo: { id: 'ceo', name: 'Mimoun', repoId: null, status: 'working' },
    x: { id: 'x', name: 'Ada', repoId: 'a', status: 'idle' },
    y: { id: 'y', name: 'Bo Li', repoId: 'b', status: 'working' },
  } as never,
  qa: { 'a#4': { repoId: 'a', prNumber: 4, status: 'needs-human' }, 'b#7': { repoId: 'b', prNumber: 7, status: 'passed' } },
};

describe('the task tutorials', () => {
  it('are short chains of one-sentence steps with unique ids', () => {
    expect(TUTORIALS.map((t) => t.id)).toEqual(['start', 'feature', 'needs-you', 'running']);
    for (const t of TUTORIALS) {
      expect(new Set(t.steps.map((s) => s.id)).size, t.id).toBe(t.steps.length);
      expect(t.steps.length).toBeGreaterThanOrEqual(3);
      expect(t.steps.length).toBeLessThanOrEqual(7);
      for (const s of t.steps) {
        expect(s.text.replace(/\{[^}]+\}/g, 'x').split(/[.!?](\s|$)/).filter((x) => x?.trim()).length, s.id).toBe(1);
        expect(s.targets.length, s.id).toBeGreaterThan(0);
      }
    }
  });

  it('rings only controls the client renders', () => {
    const src = sources();
    const missing = TUTORIALS.flatMap((t) => t.steps.flatMap((s) => s.targets.filter((sel) => !rendered(sel, src)).map((sel) => `${t.id}/${s.id} → ${sel}`)));
    expect(missing).toEqual([]);
  });

  it('opens each step on a deep link the office knows', () => {
    for (const mode of ['pocket', 'office'] as const)
      for (const t of TUTORIALS)
        for (const s of t.steps) {
          const link = stepLink(s, world, mode);
          if (link) expect(parseRoute(link), `${s.id} ${link}`).not.toBeNull();
          else expect(s.open === undefined || s.open === 'plan', s.id).toBe(true);
        }
  });

  it('picks the PR, floor and agent to show from the office', () => {
    expect(pickPr(world)).toEqual({ floor: 2, number: 7 }); // QA passed: ready to merge
    expect(pickPr(world, true)).toEqual({ floor: 1, number: 4 }); // needs you first
    expect(pickPr({ ...world, repos: [] })).toBeNull();
    expect(pickAgent(world)).toBe('Bo Li'); // busy, never the CEO
    const feature = TUTORIALS.find((t) => t.id === 'feature')!;
    expect(feature.steps.map((s) => stepLink(s, world, 'pocket'))).toEqual([null, '#floor/1/kanban', '#agent/Bo%20Li/terminal', '#pr/2/7', '#pr/2/7', '#floor/1/kanban']);
    const needs = TUTORIALS.find((t) => t.id === 'needs-you')!;
    expect(stepLink(needs.steps[2], world, 'office')).toBe('#pr/1/4'); // the PR waiting on you
    expect(stepBlocked(feature.steps[3], { ...world, repos: [] }, 'pocket')).toBe(true);
    expect(stepBlocked(feature.steps[0], { ...world, repos: [] }, 'pocket')).toBe(false);
  });

  it("finishes a tap step only on a control inside its ring, never the tour's own card", () => {
    // a tiny element: `closest` walks up its chain of selectors
    const el = (chain: string[]): Element => ({ closest: (s: string) => (s.split(', ').some((x) => chain.includes(x)) ? el(chain) : null), matches: (s: string) => chain[0] === s }) as unknown as Element;
    expect(tapUses(el(['button', '.pr-actions']), ['.pr-actions'])).toBe(true);
    expect(tapUses(el(['div', '.pr-actions']), ['.pr-actions'])).toBe(false); // not a control
    expect(tapUses(el(['button', '.kcol']), ['.pr-actions'])).toBe(false); // somewhere else
    expect(tapUses(el(['button', '.pr-actions', '.tour']), ['.pr-actions'])).toBe(false);
    expect(tapUses(null, ['.pr-actions'])).toBe(false);
    expect(sentCount([{ from: 'ceo' }, { from: 'manager' }, { from: 'office' }, { from: 'manager' }])).toBe(2);
  });
});

describe('tutorial progress', () => {
  it('starts, moves, resumes where it was and finishes', () => {
    let p = startTutorial(NO_PROGRESS, 'feature');
    expect(p.running).toBe('feature');
    expect(neverStarted(p)).toBe(false);
    p = moveTo(p, 'feature', 3);
    expect(doneOf(p, 'feature')).toEqual({ done: 3, total: 6, finished: false });
    p = pauseTutorial(p);
    expect(p.running).toBeNull();
    p = startTutorial(p, 'feature'); // Resume
    expect(p.at.feature.step).toBe(3);
    p = moveTo(p, 'feature', 6);
    expect(p.running).toBeNull();
    expect(doneOf(p, 'feature')).toEqual({ done: 6, total: 6, finished: true });
    p = startTutorial(p, 'feature', true); // Restart
    expect(p.at.feature).toEqual({ step: 0, done: false });
  });

  it('survives a reload, and anything unreadable', () => {
    const p = moveTo(startTutorial(NO_PROGRESS, 'running'), 'running', 2);
    expect(readProgress(JSON.stringify(p))).toEqual(p);
    expect(readProgress(null)).toEqual(NO_PROGRESS);
    expect(readProgress('{')).toEqual(NO_PROGRESS);
    expect(readProgress(JSON.stringify({ at: { start: { step: 99 }, gone: { step: 1 } }, running: 'gone' }))).toEqual({ at: { start: { step: 4, done: false } }, running: null });
    expect(neverStarted(NO_PROGRESS)).toBe(true);
  });
});
