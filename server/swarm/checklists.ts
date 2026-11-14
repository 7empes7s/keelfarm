// Checklists (#612): the CEO's checklist_create / checklist_update / checklist_read, the manager's ticks, "not needed",
// comments (with a photo from the files store), secret fields saved straight to Providers (the checklist keeps only the
// connection and its last 4) and duplicates. Every change goes to the tabs as a `checklist` event and wakes the CEO in
// one chat job per 30 s burst; a finished checklist is announced in the chat once. Rules pure in shared/checklists.ts.
import { addChange, announceFinish, loadChecklists, applyStep, checklistsLine, createChecklist, duplicateChecklist, editChecklist, fillSecret, progressText, readChecklist, takeWake, wakeAt, type Checklist, type ChecklistChange, type ChecklistWake, type StepAction, type StepEdit } from '../../shared/checklists.ts';
import type { WorldSnapshot } from '../../shared/types.ts';
import type { ChecklistCreateArgs, ChecklistReadArgs, ChecklistUpdateArgs } from '../ceoChecklistTools.ts';
import { HttpError } from '../httpError.ts';
import { checklistSample } from '../checklistSample.ts';
import { SwarmAgentSdk } from './agentSdk.ts';

export abstract class SwarmChecklists extends SwarmAgentSdk {
  private checklistWake: ChecklistWake = { pending: [], since: null };
  private checklistTimer: ReturnType<typeof setTimeout> | null = null;

  /** The saved checklists, from the state file. */
  protected loadChecklistsState(raw: unknown) {
    return loadChecklists(raw);
  }

  /** Left out while there are none: every tab's snapshot pays for it. */
  override snapshot(): WorldSnapshot {
    const list = this.state.checklists.list;
    return list.length ? { ...super.snapshot(), checklists: list } : super.snapshot();
  }

  private checklistOf(id: string): Checklist {
    const c = this.state.checklists.list.find((x) => x.id === id);
    if (!c) throw new HttpError(404, `No checklist ${id}: checklist_read without an id lists the open ones.`);
    return c;
  }

  private checklistChanged(c: Checklist, change?: ChecklistChange) {
    this.save();
    this.broadcast({ type: 'checklist', checklist: c });
    if (!change) return;
    addChange(this.checklistWake, change, Date.now());
    if (announceFinish(c)) {
      this.postMessage('office', `✅ Checklist done: “${c.title}”`, undefined, { checklist: { id: c.id } });
      addChange(this.checklistWake, { ...change, what: `${change.what}. The checklist is finished (${progressText(c)})` }, Date.now());
      this.save();
    }
    this.checklistTimer ??= setTimeout(() => this.checklistWakeUp(), Math.max(0, (wakeAt(this.checklistWake) ?? Date.now()) - Date.now()));
    this.checklistTimer.unref?.();
  }

  /** The 30 s window passed: one CEO job with every change in it, like the manager's messages. */
  private checklistWakeUp() {
    this.checklistTimer = null;
    const text = takeWake(this.checklistWake, Date.now());
    if (text) this.enqueueCeo({ kind: 'chat', text, messageIds: [], at: Date.now() });
  }

  /** A fresh demo office gets the sample checklist and its card in the chat, once its floors are connected. */
  protected override async startUsage() {
    if (this.backend.demo && !this.state.checklists.list.length && !this.state.checklists.seq) {
      setTimeout(() => {
        if (this.state.checklists.seq) return;
        const c = checklistSample(this.state.checklists, this.state.repos[0]?.id ?? null, Date.now());
        this.postMessage('office', `📋 Checklist: ${c.title}`, undefined, { checklist: { id: c.id } });
        this.checklistChanged(c);
      }, 3500).unref();
    }
    await super.startUsage();
  }

  // ---------- the CEO's tools ----------

  protected checklistCreate(a: ChecklistCreateArgs): string {
    const repo = a.floor === undefined ? null : this.state.repos.find((r) => r.floor === a.floor);
    if (repo === undefined) throw new Error(`No floor ${a.floor}: leave floor out, or use one of ${this.state.repos.map((r) => r.floor).join(', ') || 'none'}.`);
    const c = createChecklist(this.state.checklists, { title: a.title, repoId: repo?.id ?? null, steps: a.steps }, Date.now());
    this.postMessage('office', `📋 Checklist: ${c.title}`, undefined, { checklist: { id: c.id } });
    this.checklistChanged(c);
    return `Created ${c.id} “${c.title}” v${c.v} with ${c.steps.length} steps (s1…s${c.steps.length}); it's a card in the chat${repo ? ` and pinned on floor ${repo.floor}` : ''}. Don't repeat the steps in your reply.`;
  }

  protected checklistUpdate(a: ChecklistUpdateArgs): string {
    const c = this.checklistOf(a.id);
    const edits: StepEdit[] = [...(a.remove ?? []).map((id) => ({ op: 'remove' as const, id })), ...(a.edit ?? []).map(({ id, ...step }) => ({ op: 'edit' as const, id, step })), ...(a.add ?? []).map((x) => ({ op: 'add' as const, step: x.step, after: x.after }))];
    if (!edits.length && !a.title) throw new Error('Nothing to change: give title, add, edit or remove.');
    const r = editChecklist(c, { title: a.title, edits }, Date.now());
    if ('error' in r) throw new Error(r.error);
    this.checklistChanged(c);
    return r.ok;
  }

  protected checklistRead(a: ChecklistReadArgs): string {
    if (!a.id) return checklistsLine(this.state.checklists.list) || 'No open checklists.';
    return readChecklist(this.checklistOf(a.id), a.since);
  }

  // ---------- the manager ----------

  /** Tick, untick, not needed or a comment on a step (POST /api/checklists/:id/steps/:step). */
  checklistStep(id: string, stepId: string, body: { action?: unknown; reason?: unknown; text?: unknown; fileId?: unknown }): Checklist {
    const c = this.checklistOf(id);
    const fileId = typeof body.fileId === 'string' && body.fileId ? body.fileId : undefined;
    if (fileId && !this.files.list().some((f) => f.id === fileId)) throw new HttpError(400, 'That photo is no longer in the files store: add it again.');
    const str = (v: unknown) => (typeof v === 'string' ? v : '');
    const action: StepAction | null =
      body.action === 'tick' ? { kind: 'tick', done: true }
      : body.action === 'untick' ? { kind: 'tick', done: false }
      : body.action === 'skip' ? { kind: 'skip', reason: str(body.reason) }
      : body.action === 'comment' ? { kind: 'comment', text: str(body.text), fileId }
      : null;
    if (!action) throw new HttpError(400, 'The action is tick, untick, skip or comment.');
    const r = applyStep(c, stepId, action, Date.now());
    if ('error' in r) throw new HttpError(400, r.error);
    if (fileId) this.files.setKeep(fileId, true, `A comment on the checklist “${c.title}”`);
    this.checklistChanged(c, r.change);
    return c;
  }

  /** A secret field: the value is saved to Providers and nowhere else (POST /api/checklists/:id/steps/:step/secret). */
  async checklistSecret(id: string, stepId: string, value: unknown, accountId?: unknown): Promise<Checklist> {
    const c = this.checklistOf(id);
    const r = await fillSecret(c, stepId, typeof value === 'string' ? value : '', (provider, label, v, acct) => this.providers.add(provider, v, label, '', acct), Date.now, typeof accountId === 'string' ? accountId : '');
    if ('error' in r) throw new HttpError(400, r.error);
    this.checklistChanged(c, r.change);
    return c;
  }

  /** "Duplicate for another account" (POST /api/checklists/:id/duplicate). */
  checklistDuplicate(id: string, title: unknown): Checklist {
    const c = this.checklistOf(id);
    const d = duplicateChecklist(this.state.checklists, c, typeof title === 'string' ? title : '', Date.now());
    this.postMessage('office', `📋 Checklist: ${d.title}`, undefined, { checklist: { id: d.id } });
    this.checklistChanged(d, { checklist: d.id, title: d.title, step: '-', stepTitle: 'the whole checklist', what: `duplicated from ${c.id} “${c.title}”, every step open` });
    return d;
  }
}
