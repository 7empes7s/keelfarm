// The CEO chat on the Swarm's side (#51): the reply being written (folded from the session's text and steps, sent a
// few times a second at most), the current job's office calls for a Stop's reply, the saved threads of the other
// conversations, and the CEO's notes file for the memory screen. Kept out of swarm.ts like ceoFiles.ts.
import fs from 'node:fs/promises';
import path from 'node:path';
import { finishedSteps, foldStream, type CeoLive, type OfficeCall } from '../shared/ceoStream.ts';
import { NOTES_VIEW_MAX } from '../shared/ceoMemory.ts';
import type { LogEntry } from './agentRunner.ts';
import type { PhoneMessage } from '../shared/types.ts';

const EMIT_MS = 250;
const ID = /^c[a-z0-9]{1,24}$/;

export class CeoChat {
  live: CeoLive | null = null;
  private calls: OfficeCall[] = [];
  private readonly inflight = new Set<Promise<unknown>>();
  private lastReply = '';
  private timer: NodeJS.Timeout | undefined;

  /** `dir`: where the other conversations' threads are saved; `notesFile`: the CEO's NOTES.md. */
  constructor(
    private readonly dir: string,
    private readonly notesFile: string,
    private readonly emitLive: (live: CeoLive | null) => void,
  ) {}

  // ---------- the reply being written ----------

  /** A CEO job starts: nothing live, no office calls yet. */
  startJob() {
    this.calls = [];
    this.lastReply = '';
    this.set(null);
  }

  /** A text block of the reply (the transcript can repeat the one just posted, after its turn ended). */
  text(text: string, done: boolean) {
    if (text.trim() === this.lastReply) return;
    this.set(foldStream(this.live, { kind: 'text', text, done }, Date.now()), true);
  }

  /** The session's log lines: its tool calls become steps. */
  log(entries: readonly LogEntry[]) {
    let live = this.live;
    for (const entry of entries) if (entry.kind === 'tool' || entry.kind === 'result' || entry.kind === 'error') live = foldStream(live, { kind: 'log', entry }, Date.now());
    if (live !== this.live) this.set(live, true);
  }

  /** A turn's reply went to the phone: the steps it keeps; nothing is live until the next one. */
  finishTurn(text: string): string[] {
    const steps = finishedSteps(this.live);
    this.lastReply = text.trim();
    this.set(null);
    return steps;
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
        const call: OfficeCall = { tool, ok: false, out: null };
        this.calls.push(call);
        const p = (async () => (fn as (...a: unknown[]) => unknown)(...args))();
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
