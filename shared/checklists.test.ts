import { describe, expect, it } from 'vitest';
import { addChange, announceFinish, applyStep, createChecklist, duplicateChecklist, editChecklist, fillSecret, loadChecklists, matchChecklist, progress, progressText, readChecklist, takeWake, WAKE_MS, type ChecklistsState } from './checklists.ts';

const fresh = (): ChecklistsState => ({ seq: 0, list: [] });
const sample = (s = fresh()) =>
  createChecklist(s, {
    title: 'YouTube app',
    repoId: 'acme/shop',
    steps: [
      { title: 'Open Google Cloud', details: 'Go to **console.cloud.google.com**' },
      { title: 'Add the redirect URI', copy: [{ label: 'Redirect URI', value: 'https://office.example/oauth/google' }] },
      { title: 'Paste the client secret', secret: { label: 'Client secret', provider: 'openai' } },
    ],
  }, 1000);

describe('checklist steps', () => {
  it('ticks, unticks, marks not needed and comments, each bumping the version', () => {
    const c = sample();
    expect(progressText(c)).toBe('0 of 3 done');
    const t = applyStep(c, 's1', { kind: 'tick', done: true }, 2000);
    expect(t).toMatchObject({ change: { step: 's1', what: 'done' } });
    expect(c.steps[0]).toMatchObject({ state: 'done', v: 2 });
    expect(applyStep(c, 's1', { kind: 'tick', done: true }, 2001)).toEqual({ error: 'That step is already done.' });
    applyStep(c, 's1', { kind: 'tick', done: false }, 2100);
    expect(c.steps[0].state).toBe('open');
    expect(applyStep(c, 's2', { kind: 'skip', reason: 'no 2nd account' }, 2200)).toMatchObject({ change: { what: 'not needed: no 2nd account' } });
    expect(c.steps[1]).toMatchObject({ state: 'skipped', reason: 'no 2nd account' });
    applyStep(c, 's2', { kind: 'tick', done: true }, 2300);
    expect(c.steps[1].reason).toBeUndefined();
    expect(applyStep(c, 's3', { kind: 'comment', text: 'Which project?', fileId: 'f1' }, 2400)).toMatchObject({ change: { what: 'comment: Which project? (with a photo)' } });
    expect(c.steps[2].comments).toEqual([{ id: 1, at: 2400, text: 'Which project?', fileId: 'f1' }]);
    expect(applyStep(c, 's3', { kind: 'comment', text: '  ' }, 2500)).toEqual({ error: 'Write a comment or add a photo first.' });
    expect(applyStep(c, 's9', { kind: 'tick', done: true }, 2500)).toMatchObject({ error: expect.stringContaining('No step s9') });
    expect(c.v).toBe(6); // five changes after v1
  });

  it('counts progress with not needed as done, and is finished once every step is', () => {
    const c = sample();
    applyStep(c, 's1', { kind: 'tick', done: true }, 2);
    applyStep(c, 's2', { kind: 'skip' }, 3);
    expect(progress(c)).toEqual({ done: 2, total: 3, finished: false });
    expect(c.doneAt).toBeNull();
    applyStep(c, 's3', { kind: 'tick', done: true }, 4);
    expect(progress(c)).toEqual({ done: 3, total: 3, finished: true });
    expect(c.doneAt).toBe(4);
    expect(announceFinish(c)).toBe(true);
    expect(announceFinish(c)).toBe(false); // once
    applyStep(c, 's3', { kind: 'tick', done: false }, 5);
    applyStep(c, 's3', { kind: 'tick', done: true }, 6);
    expect(announceFinish(c)).toBe(false);
    expect(progress({ steps: [] }).finished).toBe(false);
  });

  it('duplicates for another account: open steps, no comments, secrets unsaved', () => {
    const s = fresh();
    const c = sample(s);
    applyStep(c, 's1', { kind: 'tick', done: true }, 2);
    applyStep(c, 's1', { kind: 'comment', text: 'done on account 1' }, 3);
    applyStep(c, 's3', { kind: 'secret', connectionId: 'k1', hint: 'ab12' }, 4);
    const d = duplicateChecklist(s, c, 'YouTube app · second account', 10);
    expect(d).toMatchObject({ id: 'c2', title: 'YouTube app · second account', from: 'c1', repoId: 'acme/shop', v: 1, doneAt: null });
    expect(d.steps.map((x) => [x.state, x.comments.length, x.secret?.saved])).toEqual([['open', 0, undefined], ['open', 0, undefined], ['open', 0, undefined]]);
    expect(d.steps[1].copy).toEqual(c.steps[1].copy);
    expect(c.steps[0].state).toBe('done'); // the original keeps its state
    expect(s.list.map((x) => x.id)).toEqual(['c2', 'c1']);
  });
});

describe('secret fields', () => {
  it('never keep the value: only the Providers connection and its last 4', async () => {
    const c = sample();
    const value = 'GOCSPX-very-secret-value-ab12';
    const saved: string[] = [];
    const out = await fillSecret(c, 's3', `  ${value} `, async (provider, label, v) => (saved.push(`${provider}|${label}|${v}`), { id: 'k7', keyHint: v.slice(-4) }), () => 50);
    expect(saved).toEqual([`openai|Client secret · YouTube app|${value}`]);
    expect(c.steps[2].secret).toEqual({ label: 'Client secret', provider: 'openai', saved: { connectionId: 'k7', hint: 'ab12', at: 50 } });
    expect(c.steps[2].state).toBe('done');
    const w = { pending: [], since: null };
    if ('change' in out) addChange(w, out.change, 50);
    const wake = takeWake(w, 50 + WAKE_MS)!;
    for (const text of [JSON.stringify(c), JSON.stringify(out), readChecklist(c), wake]) expect(text).not.toContain(value);
    expect(readChecklist(c)).toContain('saved to Providers (openai, ends …ab12)');
    expect(await fillSecret(c, 's1', value, async () => ({ id: 'x', keyHint: 'x' }), () => 1)).toEqual({ error: 'That step has no secret field.' });
  });
});

describe('waking the CEO', () => {
  it('batches 5 ticks within 30 s into one job', () => {
    const c = sample();
    c.steps.push(...[4, 5].map((n) => ({ ...c.steps[0], id: `s${n}` })));
    const w = { pending: [], since: null } as Parameters<typeof addChange>[0];
    const jobs: string[] = [];
    let t = 10_000;
    for (const id of ['s1', 's2', 's3', 's4', 's5']) {
      const r = applyStep(c, id, { kind: 'tick', done: true }, t);
      if ('change' in r) addChange(w, r.change, t);
      const job = takeWake(w, t);
      if (job) jobs.push(job);
      t += 5_000;
    }
    expect(jobs).toEqual([]);
    const job = takeWake(w, 10_000 + WAKE_MS);
    expect(job).toContain('Checklist c1 “YouTube app”:');
    expect(job!.match(/^- s\d/gm)).toHaveLength(5);
    expect(takeWake(w, 10_000 + 2 * WAKE_MS)).toBeNull();
    expect(w).toEqual({ pending: [], since: null });
  });
});

describe('the CEO edits and reads', () => {
  it('adds, edits and removes steps; checklist_read lists only what changed since a version', () => {
    const c = sample();
    applyStep(c, 's1', { kind: 'tick', done: true }, 2); // v2
    const r = editChecklist(c, { edits: [{ op: 'add', step: { title: 'Verify the app' }, after: 's1' }, { op: 'edit', id: 's2', step: { title: 'Add both redirect URIs' } }, { op: 'remove', id: 's3' }] }, 3);
    expect(r).toEqual({ ok: '“YouTube app” v3: 1 of 3 done.' });
    expect(c.steps.map((s) => [s.id, s.title])).toEqual([['s1', 'Open Google Cloud'], ['s4', 'Verify the app'], ['s2', 'Add both redirect URIs']]);
    expect(c.steps[2].copy).toHaveLength(1); // kept
    expect(editChecklist(c, { edits: [{ op: 'remove', id: 's9' }] }, 4)).toMatchObject({ error: expect.stringContaining('checklist_read') });
    const since = readChecklist(c, 2);
    expect(since.split('\n')[0]).toBe('c1 “YouTube app” v3 · 1 of 3 done · 2 changed since v2');
    expect(since).toContain('s4 [ ] Verify the app');
    expect(since).not.toContain('Open Google Cloud');
    expect(readChecklist(c)).toContain('s1 [x] Open Google Cloud');
  });

  it('loads a saved state and searches titles, steps and comments', () => {
    const s = fresh();
    const c = sample(s);
    applyStep(c, 's1', { kind: 'comment', text: 'Brand account' }, 2);
    expect(loadChecklists(JSON.parse(JSON.stringify(s)))).toEqual(s);
    expect(loadChecklists(null)).toEqual({ seq: 0, list: [] });
    expect(matchChecklist(c, 'redirect')).toBe(true);
    expect(matchChecklist(c, 'brand')).toBe(true);
    expect(matchChecklist(c, 'twitch')).toBe(false);
  });
});
