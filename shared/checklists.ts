// Checklists (#612): steps the CEO gives the manager as a tickable card. Each step has light-markdown details, values to
// copy (a redirect URI) and an optional secret field whose value goes straight to Providers: the checklist keeps only
// the connection's id and last 4 characters. The manager ticks, marks "not needed", comments (with a photo) and
// duplicates; each change wakes the CEO in one job per 30 s burst. Pure: the swarm keeps the state
// (server/swarm/checklists.ts), the client draws it (client/src/ui/Checklists*.tsx).

import { PROVIDERS } from './providers.ts';

type StepState = 'open' | 'done' | 'skipped';

/** Where a secret field can save: the Providers page's key entries. */
export const SECRET_PROVIDERS = PROVIDERS.filter((p) => p.home === 'providers' && p.auth === 'api-key').map((p) => p.id) as [string, ...string[]];

interface ChecklistCopy {
  label: string;
  value: string;
}

interface ChecklistSecret {
  label: string; // "Client secret"
  provider: string; // the Providers catalogue id it's saved under
  /** Saved to Providers: the connection and its last 4 characters, never the value. */
  saved?: { connectionId: string; hint: string; at: number };
}

interface ChecklistComment {
  id: number;
  at: number;
  text: string; // the manager's
  fileId?: string; // a photo in the files store
}

export interface ChecklistStep {
  id: string;
  title: string;
  details: string;
  copy: ChecklistCopy[];
  secret: ChecklistSecret | null;
  state: StepState;
  reason?: string; // why it's not needed
  comments: ChecklistComment[];
  v: number; // the checklist's version when this step last changed
}

export interface Checklist {
  id: string;
  title: string;
  repoId: string | null;
  steps: ChecklistStep[];
  createdAt: number;
  updatedAt: number;
  v: number;
  doneAt: number | null; // every step done or not needed
  announced: boolean; // its finish was announced (once)
  from?: string; // duplicated from this checklist
}

export interface ChecklistsState {
  seq: number;
  list: Checklist[];
}

/** The CEO's step as it writes it (checklist_create / checklist_update). */
export interface StepInput {
  title: string;
  details?: string;
  copy?: ChecklistCopy[];
  secret?: { label: string; provider: string };
}

/** The manager's action on a step. */
export type StepAction =
  | { kind: 'tick'; done: boolean }
  | { kind: 'skip'; reason?: string }
  | { kind: 'comment'; text: string; fileId?: string }
  | { kind: 'secret'; connectionId: string; hint: string };

/** A change the CEO hears about. */
export interface ChecklistChange {
  checklist: string;
  title: string;
  step: string;
  stepTitle: string;
  what: string; // "done", "not needed: no 2nd account", "comment: …", "secret saved (ends …ab12)"
}

export const MAX_STEPS = 40;
const MAX_CHECKLISTS = 60;
const MAX_COMMENTS = 30;
export const WAKE_MS = 30_000;
const KEEP_DONE_MS = 30 * 24 * 60 * 60_000;

const clip = (s: unknown, n: number) => (typeof s === 'string' ? s.trim().slice(0, n) : '');

function step(input: StepInput, id: string, v: number): ChecklistStep {
  return {
    id,
    title: clip(input.title, 200) || 'Step',
    details: clip(input.details, 2000),
    copy: (input.copy ?? []).slice(0, 6).map((c) => ({ label: clip(c.label, 60), value: clip(c.value, 1000) })).filter((c) => c.value),
    secret: input.secret ? { label: clip(input.secret.label, 60) || 'Secret', provider: input.secret.provider } : null,
    state: 'open',
    comments: [],
    v,
  };
}

const nextStepId = (c: Pick<Checklist, 'steps'>) => `s${Math.max(0, ...c.steps.map((s) => Number(s.id.slice(1)) || 0)) + 1}`;

/** A new checklist from the CEO's steps. */
export function createChecklist(s: ChecklistsState, a: { title: string; repoId?: string | null; steps: StepInput[] }, now: number): Checklist {
  const c: Checklist = { id: `c${++s.seq}`, title: clip(a.title, 120) || 'Checklist', repoId: a.repoId ?? null, steps: [], createdAt: now, updatedAt: now, v: 1, doneAt: null, announced: false };
  for (const input of a.steps.slice(0, MAX_STEPS)) c.steps.push(step(input, nextStepId(c), 1));
  s.list.unshift(c);
  pruneChecklists(s, now);
  return c;
}

/** Done or not needed, out of every step. */
export function progress(c: Pick<Checklist, 'steps'>): { done: number; total: number; finished: boolean } {
  const done = c.steps.filter((s) => s.state !== 'open').length;
  return { done, total: c.steps.length, finished: c.steps.length > 0 && done === c.steps.length };
}

/** "3 of 6 done". */
export const progressText = (c: Pick<Checklist, 'steps'>) => {
  const p = progress(c);
  return `${p.done} of ${p.total} done`;
};

export const isOpenChecklist = (c: Pick<Checklist, 'steps'>) => !progress(c).finished;

function touch(c: Checklist, s: ChecklistStep | null, now: number) {
  c.v += 1;
  c.updatedAt = now;
  if (s) s.v = c.v;
  const { finished } = progress(c);
  c.doneAt = finished ? (c.doneAt ?? now) : null;
}

/** The manager's action on a step: the change to tell the CEO, or an error the manager can act on. */
export function applyStep(c: Checklist, stepId: string, a: StepAction, now: number): { change: ChecklistChange } | { error: string } {
  const s = c.steps.find((x) => x.id === stepId);
  if (!s) return { error: `No step ${stepId} on “${c.title}”.` };
  let what: string;
  switch (a.kind) {
    case 'tick':
      if (s.state === (a.done ? 'done' : 'open')) return { error: a.done ? 'That step is already done.' : 'That step is already open.' };
      s.state = a.done ? 'done' : 'open';
      delete s.reason;
      what = a.done ? 'done' : 'ticked off again (open)';
      break;
    case 'skip': {
      s.state = 'skipped';
      const reason = clip(a.reason, 300);
      if (reason) s.reason = reason;
      else delete s.reason;
      what = `not needed${reason ? `: ${reason}` : ''}`;
      break;
    }
    case 'comment': {
      const text = clip(a.text, 1000);
      if (!text && !a.fileId) return { error: 'Write a comment or add a photo first.' };
      s.comments.push({ id: Math.max(0, ...s.comments.map((m) => m.id)) + 1, at: now, text, ...(a.fileId ? { fileId: a.fileId } : {}) });
      s.comments = s.comments.slice(-MAX_COMMENTS);
      what = `comment: ${text || '(a photo)'}${a.fileId && text ? ' (with a photo)' : ''}`;
      break;
    }
    case 'secret':
      if (!s.secret) return { error: 'That step has no secret field.' };
      s.secret = { ...s.secret, saved: { connectionId: a.connectionId, hint: a.hint.slice(-4), at: now } };
      s.state = 'done'; // pasting it was the step
      delete s.reason;
      what = `${s.secret.label} saved to Providers (ends …${a.hint.slice(-4)})`;
      break;
  }
  touch(c, s, now);
  return { change: { checklist: c.id, title: c.title, step: s.id, stepTitle: s.title, what } };
}

/** Save a secret field: the value goes only to `save` (Providers); the step keeps its connection and last 4. */
export async function fillSecret(c: Checklist, stepId: string, value: string, save: (provider: string, label: string, value: string) => Promise<{ id: string; keyHint: string }>, now: () => number) {
  const s = c.steps.find((x) => x.id === stepId);
  if (!s?.secret) return { error: s ? 'That step has no secret field.' : `No step ${stepId} on “${c.title}”.` };
  if (!value.trim()) return { error: 'Paste the value first.' };
  const conn = await save(s.secret.provider, `${s.secret.label} · ${c.title}`.slice(0, 60), value.trim());
  return applyStep(c, stepId, { kind: 'secret', connectionId: conn.id, hint: conn.keyHint }, now());
}

/** A copy for another account: every step open again, no comments, secrets unsaved. */
export function duplicateChecklist(s: ChecklistsState, c: Checklist, title: string, now: number): Checklist {
  const d: Checklist = {
    ...c,
    id: `c${++s.seq}`,
    title: clip(title, 120) || `${c.title} (copy)`,
    steps: c.steps.map((x) => ({ id: x.id, title: x.title, details: x.details, copy: x.copy.map((y) => ({ ...y })), secret: x.secret ? { label: x.secret.label, provider: x.secret.provider } : null, state: 'open' as StepState, comments: [], v: 1 })),
    createdAt: now,
    updatedAt: now,
    v: 1,
    doneAt: null,
    announced: false,
    from: c.id,
  };
  s.list.unshift(d);
  pruneChecklists(s, now);
  return d;
}

/** The CEO's edits (checklist_update): add, edit or remove steps, or retitle. */
export type StepEdit = { op: 'add'; step: StepInput; after?: string } | { op: 'edit'; id: string; step: Partial<StepInput> } | { op: 'remove'; id: string };

export function editChecklist(c: Checklist, a: { title?: string; edits: StepEdit[] }, now: number): { error: string } | { ok: string } {
  for (const e of a.edits) if (e.op !== 'add' && !c.steps.some((s) => s.id === e.id)) return { error: `No step ${e.id} on “${c.title}”: checklist_read lists its step ids.` };
  if (c.steps.length + a.edits.filter((e) => e.op === 'add').length > MAX_STEPS) return { error: `A checklist has at most ${MAX_STEPS} steps: split it.` };
  touch(c, null, now);
  if (a.title?.trim()) c.title = clip(a.title, 120);
  for (const e of a.edits) {
    if (e.op === 'remove') c.steps = c.steps.filter((s) => s.id !== e.id);
    else if (e.op === 'add') {
      const at = e.after ? c.steps.findIndex((x) => x.id === e.after) : -1;
      c.steps.splice(at < 0 ? c.steps.length : at + 1, 0, step(e.step, nextStepId(c), c.v));
    } else {
      const s = c.steps.find((x) => x.id === e.id)!;
      const fresh = step({ title: e.step.title ?? s.title, details: e.step.details ?? s.details, copy: e.step.copy ?? s.copy, secret: e.step.secret }, s.id, c.v);
      Object.assign(s, { title: fresh.title, details: fresh.details, copy: fresh.copy, v: c.v, secret: e.step.secret ? fresh.secret : s.secret });
    }
  }
  const { finished } = progress(c);
  c.doneAt = finished ? (c.doneAt ?? now) : null;
  return { ok: `“${c.title}” v${c.v}: ${progressText(c)}.` };
}

/** checklist_read: the steps changed since version `since` (all of them without it), with their state and comments. */
export function readChecklist(c: Checklist, since?: number): string {
  const steps = c.steps.filter((s) => since === undefined || s.v > since);
  const head = `${c.id} “${c.title}” v${c.v} · ${progressText(c)}${c.doneAt ? ' · finished' : ''}${since !== undefined ? ` · ${steps.length} changed since v${since}` : ''}`;
  const rows = steps.map((s) => {
    const state = s.state === 'done' ? '[x]' : s.state === 'skipped' ? `[-] not needed${s.reason ? ` (${s.reason})` : ''}` : '[ ]';
    const secret = s.secret ? ` · ${s.secret.label}: ${s.secret.saved ? `saved to Providers (${s.secret.provider}, ends …${s.secret.saved.hint})` : 'not filled'}` : '';
    const notes = s.comments.slice(-3).map((m) => `\n    manager: ${m.text || '(photo)'}${m.fileId && m.text ? ' (+photo)' : ''}`);
    return `${s.id} ${state} ${s.title}${secret}${notes.join('')}`;
  });
  return [head, ...rows].join('\n');
}

/** The open checklists in a line each, for the CEO. */
export const checklistsLine = (list: readonly Checklist[]) => list.filter(isOpenChecklist).slice(0, 8).map((c) => `${c.id} “${c.title}” ${progressText(c)}`).join('\n');

/** Finished checklists kept a month; at most MAX_CHECKLISTS, open ones first. */
function pruneChecklists(s: ChecklistsState, now: number) {
  s.list = s.list.filter((c) => !c.doneAt || now - c.doneAt < KEEP_DONE_MS);
  if (s.list.length > MAX_CHECKLISTS) {
    const keep = new Set([...s.list.filter(isOpenChecklist), ...s.list.filter((c) => !isOpenChecklist(c))].slice(0, MAX_CHECKLISTS));
    s.list = s.list.filter((c) => keep.has(c));
  }
}

// ---------- waking the CEO ----------

/** Changes waiting to wake the CEO: the first one starts a 30 s window, everything in it goes in one job. */
export interface ChecklistWake {
  pending: ChecklistChange[];
  since: number | null;
}

export function addChange(w: ChecklistWake, ch: ChecklistChange, now: number) {
  w.pending.push(ch);
  w.since ??= now;
}

/** When the waiting changes go to the CEO, or null with none. */
export const wakeAt = (w: ChecklistWake) => (w.since === null ? null : w.since + WAKE_MS);

/** The job's text once its window passed (null before, or with nothing waiting), emptying the batch. */
export function takeWake(w: ChecklistWake, now: number): string | null {
  const at = wakeAt(w);
  if (at === null || now < at) return null;
  const by = new Map<string, ChecklistChange[]>();
  for (const ch of w.pending) by.set(ch.checklist, [...(by.get(ch.checklist) ?? []), ch]);
  w.pending = [];
  w.since = null;
  const lines = [...by.values()].map((list) => [`Checklist ${list[0].checklist} “${list[0].title}”:`, ...list.map((ch) => `- ${ch.step} ${ch.stepTitle}: ${ch.what}`)].join('\n'));
  return `The manager worked on their checklists (checklist_read with since= for the rest):\n${lines.join('\n')}`;
}

/** A finished checklist not announced yet: marks it, so the finish is announced once. */
export function announceFinish(c: Checklist): boolean {
  if (!c.doneAt || c.announced) return false;
  c.announced = true;
  return true;
}

/** The saved state, well formed. */
export function loadChecklists(raw: unknown): ChecklistsState {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<ChecklistsState>;
  const list = Array.isArray(r.list) ? r.list.filter((c): c is Checklist => !!c && typeof c.id === 'string' && Array.isArray(c.steps)) : [];
  return { seq: Number.isInteger(r.seq) ? r.seq! : list.length, list };
}

/** Search text and filters for the Checklists page. */
export function matchChecklist(c: Checklist, q: string): boolean {
  const t = q.trim().toLowerCase();
  if (!t) return true;
  return [c.title, ...c.steps.flatMap((s) => [s.title, s.details, ...s.comments.map((m) => m.text)])].some((x) => x.toLowerCase().includes(t));
}
