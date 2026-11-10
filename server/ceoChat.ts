// The CEO chat on the Swarm's side (#51): the reply being written (folded from the session's text and steps, sent a
// few times a second at most), the current job's office calls for a Stop's reply, the saved threads of the other
// conversations, and the CEO's notes file for the memory screen. Kept out of swarm.ts like ceoFiles.ts.
import { AsyncLocalStorage } from 'node:async_hooks';
import fs from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { finishedLog, foldStream, type CeoLive, type OfficeCall } from '../shared/ceoStream.ts';
import type { NameOf } from '../shared/ceoSteps.ts';
import { actionCards } from '../shared/ceoActions.ts';
import { NOTES_VIEW_MAX } from '../shared/ceoMemory.ts';
import { inScope, startConversation, threadStats, touchConversation, type ChatsState, type ThreadScope } from '../shared/conversations.ts';
import { filterLibrary, libraryCounts, libraryItems, pageLibrary, type LibraryFilter, type LibraryPage } from '../shared/library.ts';
import type { FileRef } from '../shared/files.ts';
import { HttpError } from './httpError.ts';
import type { LogEntry } from './agentRunner.ts';
import type { FileStore } from './files.ts';
import type { PhoneMessage } from '../shared/types.ts';

const EMIT_MS = 250;
const ID = /^c[a-z0-9]{1,24}$/;
const current = new AsyncLocalStorage<OfficeCall>(); // the office call a handler runs in, for noteMessage

/** A demo thread (server/demoThreads.ts): its project, its messages (one may carry a made-up image) and its flags. */
export interface DemoThread {
  repoId: string | null;
  pinned?: boolean;
  archived?: boolean;
  messages: (Omit<PhoneMessage, 'id' | 'attachments'> & { image?: { name: string; png: Buffer } })[];
}

export class CeoChat {
  live: CeoLive | null = null;
  private calls: OfficeCall[] = [];
  private turnFrom = 0; // the current turn's first office call
  private readonly inflight = new Set<Promise<unknown>>();
  private lastReply = '';
  private timer: NodeJS.Timeout | undefined;

  /** `dir`: where the other conversations' threads are saved; `notesFile`: the CEO's NOTES.md; `repoOf`: a floor's repo id; `agentOf`: an agent's id from an id or name; `nameOf`: an agent's name. */
  constructor(
    private readonly dir: string,
    private readonly notesFile: string,
    private readonly emitLive: (live: CeoLive | null) => void,
    private readonly repoOf: (floor: number) => string | null = () => null,
    private readonly agentOf: (ref: string) => string | null = () => null,
    private readonly nameOf: NameOf = () => null,
  ) {}

  // ---------- the reply being written ----------

  /** A CEO job starts: nothing live, no office calls yet. */
  startJob() {
    this.calls = [];
    this.turnFrom = 0;
    this.lastReply = '';
    this.set(null);
  }

  /** A text block of the reply (the transcript can repeat the one just posted, after its turn ended). */
  text(text: string, done: boolean) {
    if (text.trim() === this.lastReply) return;
    this.set(foldStream(this.live, { kind: 'text', text, done }, Date.now()), true);
  }

  /** A step of the office's own: how the job's session started, fresh or carried on (#330). */
  note(icon: string, label: string) {
    this.set(foldStream(this.live, { kind: 'note', icon, label }, Date.now()), true);
  }

  /** The session's log lines: its tool calls become steps. */
  log(entries: readonly LogEntry[]) {
    let live = this.live;
    for (const entry of entries) if (entry.kind === 'tool' || entry.kind === 'result' || entry.kind === 'error') live = foldStream(live, { kind: 'log', entry }, Date.now(), this.nameOf);
    if (live !== this.live) this.set(live, true);
  }

  /** A turn's reply went to the phone: the step log and action cards it keeps (for its message); nothing is live until the next one. */
  finishTurn(text: string): Pick<PhoneMessage, 'log' | 'actions'> {
    const log = finishedLog(this.live, Date.now());
    const actions = this.turnActions(this.calls);
    this.turnFrom = this.calls.length;
    this.lastReply = text.trim();
    this.set(null);
    return { ...(log && { log }), ...(actions.length && { actions }) };
  }

  /** The cards for the current turn's calls among `calls` (this job's, e.g. from settled()). */
  turnActions(calls: readonly OfficeCall[]) {
    return actionCards(calls.slice(this.turnFrom), this.repoOf, this.agentOf);
  }

  /** The job ended (or was stopped) with nothing more to say. */
  endJob() {
    if (this.live) this.set(null);
  }

  private set(live: CeoLive | null, soon = false) {
    this.live = live;
    if (soon) {
      this.timer ??= setTimeout(() => {
        this.timer = undefined;
        this.emitLive(this.live);
      }, EMIT_MS);
      return;
    }
    clearTimeout(this.timer);
    this.timer = undefined;
    this.emitLive(live);
  }

  // ---------- office calls ----------

  /** The office tools' handlers, each call noted in the job it was made in (its name in snake_case, like the tool's). */
  track<T extends object>(handlers: T): T {
    const out: Record<string, unknown> = {};
    for (const [name, fn] of Object.entries(handlers)) {
      if (typeof fn !== 'function') continue;
      const tool = name.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
      out[name] = async (...args: unknown[]) => {
        const input = args[0];
        const call: OfficeCall = { tool, ok: false, out: null, ...(typeof input === 'object' && input !== null ? { args: input as Record<string, unknown> } : {}) };
        this.calls.push(call);
        const p = current.run(call, async () => (fn as (...a: unknown[]) => unknown)(...args));
        this.inflight.add(p);
        try {
          const r = await p;
          Object.assign(call, { ok: true, out: String(r) });
          return r;
        } catch (err) {
          Object.assign(call, { ok: false, out: err instanceof Error ? err.message : String(err) });
          throw err;
        } finally {
          this.inflight.delete(p);
        }
      };
    }
    return out as T;
  }

  /** Inside an office call (message_agent, answer_agent): the agent chat item it posted, which its card opens. Elsewhere nothing. */
  noteMessage(id: number) {
    const call = current.getStore();
    if (call) call.messageId = id;
  }

  /** The current job's calls once those still running have finished (or `ms` passed). */
  async settled(ms: number): Promise<OfficeCall[]> {
    const calls = this.calls;
    let timer: NodeJS.Timeout | undefined;
    await Promise.race([Promise.allSettled(this.inflight), new Promise((r) => (timer = setTimeout(r, ms)))]);
    clearTimeout(timer);
    return calls;
  }

  // ---------- conversations' threads ----------

  private file(id: string) {
    if (!ID.test(id)) throw new Error(`Bad conversation id ${id}`);
    return path.join(this.dir, `${id}.json`);
  }

  async saveThread(id: string, messages: readonly PhoneMessage[]) {
    await fs.mkdir(this.dir, { recursive: true });
    const tmp = `${this.file(id)}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(messages));
    await fs.rename(tmp, this.file(id));
  }

  /** A saved thread ([] when it has none). */
  async loadThread(id: string): Promise<PhoneMessage[]> {
    const raw = await fs.readFile(this.file(id), 'utf8').catch(() => '[]');
    try {
      const list: unknown = JSON.parse(raw);
      return Array.isArray(list) ? (list as PhoneMessage[]) : [];
    } catch {
      return [];
    }
  }

  /** Threads saved before #132 get their floors, files and CEO time from their messages; how many were filled. */
  async backfill(s: ChatsState, ids: readonly string[]): Promise<number> {
    const todo = s.list.filter((c) => ids.includes(c.id) && c.id !== s.current);
    await Promise.all(todo.map(async (c) => Object.assign(c, threadStats(await this.loadThread(c.id)))));
    return todo.length;
  }

  /**
   * GET /api/ceo/library: the artifacts and files of a scope's threads (a floor's project, the Company's, or all, which
   * adds the stored files no message carries), a page at a time, with their markdown. `current`: the open thread's messages;
   * `repoIds`: the floors' projects, any other scope is a 400.
   */
  async library(s: ChatsState, current: readonly PhoneMessage[], stored: readonly FileRef[], q: { scope: ThreadScope; filter: LibraryFilter; after?: string }, repoIds: readonly string[]): Promise<LibraryPage> {
    if (!['all', 'company', ...repoIds].includes(q.scope)) throw new HttpError(400, `No floor has the project ${q.scope}: use all, company or a floor's repo id.`);
    const threads = await Promise.all(s.list.filter((c) => inScope(c, q.scope)).map(async (c) => ({ id: c.id, messages: c.id === s.current ? current : await this.loadThread(c.id) })));
    const items = libraryItems(threads, q.scope === 'all' ? stored : [], true);
    return { ...pageLibrary(filterLibrary(items, q.filter), q.after), counts: libraryCounts(items) };
  }

  /**
   * The demo's threads across floors (#132): each saved as an older conversation, its messages numbered from `seq`
   * (the next free id is returned) and `image` turned into a stored PNG. The current conversation, holding `open`
   * (the demo's seeded chat), stays the one open.
   */
  async seed(s: ChatsState, open: readonly PhoneMessage[], seeds: readonly DemoThread[], store: Pick<FileStore, 'addStream'>, seq: number): Promise<number> {
    for (const m of open) touchConversation(s, m);
    const current = s.current;
    for (const t of seeds) {
      startConversation(s, null, t.messages[0]?.at ?? Date.now(), t.repoId);
      const c = s.list.find((x) => x.id === s.current)!;
      const messages: PhoneMessage[] = [];
      for (const m of t.messages) {
        // A nearly full disk (the files' guard) leaves the sample photo out rather than stopping the demo booting.
        const img = m.image;
        const file = img ? await store.addStream(Readable.from([img.png]), { name: img.name, type: 'image/png', from: 'ceo' }).catch((e: unknown) => (console.warn(`demo chat: left out ${img.name}: ${(e as Error).message}`), null)) : null;
        const attachments = file ? [file] : undefined;
        const { image: _, ...rest } = m;
        const id = seq++;
        const msg: PhoneMessage = { ...rest, id, ...(attachments && { attachments }), ...(rest.artifacts && { artifacts: rest.artifacts.map((a, i) => ({ ...a, id: `${id}-${i}` })) }) };
        messages.push(msg);
        touchConversation(s, msg);
      }
      Object.assign(c, { pinned: !!t.pinned, archived: !!t.archived });
      await this.saveThread(c.id, messages);
    }
    s.current = current;
    return seq;
  }

  async dropThreads(ids: readonly string[]) {
    await Promise.all(ids.map((id) => fs.rm(this.file(id), { force: true, maxRetries: 3 }).catch(() => undefined)));
  }

  // ---------- the CEO's notes ----------

  /** NOTES.md for the memory screen, read-only ('' before the CEO wrote any). */
  async notes(): Promise<{ text: string; truncated: boolean; at: number | null }> {
    const [text, stat] = await Promise.all([fs.readFile(this.notesFile, 'utf8').catch(() => ''), fs.stat(this.notesFile).catch(() => null)]);
    return { text: text.slice(0, NOTES_VIEW_MAX), truncated: text.length > NOTES_VIEW_MAX, at: stat?.mtimeMs ?? null };
  }
}
