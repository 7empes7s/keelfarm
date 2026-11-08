// Getting voice previews ready before they're tapped (#279), the pure part: which voices are warmed first, which the
// background may load (library voices without a preview cost ElevenLabs characters, so only the shortlist and what's
// on screen), when the intro gives way to the list, and a small queue that loads each clip at most once.
import type { VoiceOption } from '../../../shared/types';

/** How many voices the intro waits for, how long at most, and how many clips load at once. */
export const WARM_FIRST = 5;
export const WARM_CAP_MS = 8000;
const WARM_CONCURRENCY = 2;

/** What a voice's preview is cached under: its own preview's URL, else the test line in its voice, model and speed. */
export const warmKey = (v: VoiceOption, model: string, speed: number) => (v.previewUrl ? `url:${v.previewUrl}` : `sample:${v.id}:${model}:${speed}`);

/** The voices the intro waits for: the chosen one, then favourites, the Recommended ones, then the list's order. */
export function warmFirst(list: readonly VoiceOption[], favourites: readonly string[], chosen: string, n = WARM_FIRST): VoiceOption[] {
  const rank = (v: VoiceOption) => (v.id === chosen ? 0 : favourites.includes(v.id) ? 1 : v.recommended ? 2 : 3);
  return list
    .map((v, i) => ({ v, i }))
    .sort((a, b) => rank(a.v) - rank(b.v) || a.i - b.i)
    .slice(0, n)
    .map((x) => x.v);
}

/** Whether the background may load `v`: a preview of its own is free to fetch; the test line is made only when it's shortlisted or on screen. */
export const mayWarm = (v: VoiceOption, favourites: readonly string[], chosen: string, visible: ReadonlySet<string>) =>
  !!v.previewUrl || v.recommended || v.id === chosen || favourites.includes(v.id) || visible.has(v.id);

/** The background's order: the rows on screen first, then the list's order, only the ones it may load. */
export function warmRest(list: readonly VoiceOption[], favourites: readonly string[], chosen: string, visible: ReadonlySet<string>): VoiceOption[] {
  const ok = list.filter((v) => mayWarm(v, favourites, chosen, visible));
  return [...ok.filter((v) => visible.has(v.id)), ...ok.filter((v) => !visible.has(v.id))];
}

/** The intro gives way to the list once it's skipped, every voice it waits for is done, or the cap is up. */
export const introOver = (done: number, total: number, elapsedMs: number, skipped: boolean, cap = WARM_CAP_MS) => skipped || (total > 0 && done >= total) || elapsedMs >= cap;

/** The intro's one line. */
export const introLine = (ready: number, total: number) => (total ? `Getting voices ready… ${Math.min(ready, total)} of ${total}` : 'Getting voices ready…');

export type WarmState = 'loading' | 'ready' | 'failed';

/**
 * Loads clips a few at a time, in the order asked, each key at most once: a key that's loading or loaded is never
 * loaded again, and `now` (a tap) shares the load already running. `pause` drops what's waiting (the picker closed).
 */
export class WarmQueue<T> {
  private readonly loads = new Map<string, Promise<T>>();
  private readonly states = new Map<string, WarmState>();
  private readonly values = new Map<string, T>();
  private pending: string[] = [];
  private running = 0;
  private paused = false;

  constructor(
    private readonly load: (key: string) => Promise<T>,
    private readonly concurrency = WARM_CONCURRENCY,
    private readonly onChange: () => void = () => undefined,
  ) {}

  state(key: string): WarmState | undefined {
    return this.states.get(key);
  }

  value(key: string): T | undefined {
    return this.values.get(key);
  }

  /** Queues `keys` in order, ahead of what's waiting when `front`, and resumes a paused queue. */
  want(keys: readonly string[], front = false) {
    this.paused = false;
    const fresh = [...new Set(keys)].filter((k) => !this.states.has(k));
    const rest = this.pending.filter((k) => !fresh.includes(k));
    this.pending = front ? [...fresh, ...rest] : [...rest, ...fresh];
    this.pump();
  }

  /** The clip for `key` now, sharing a load that's running or done; a failed one is tried again. */
  now(key: string): Promise<T> {
    const running = this.states.get(key) !== 'failed' && this.loads.get(key);
    if (running) return running;
    this.pending = this.pending.filter((k) => k !== key);
    return this.start(key);
  }

  pause() {
    this.paused = true;
    this.pending = [];
  }

  private start(key: string): Promise<T> {
    this.states.set(key, 'loading');
    this.onChange();
    const p = this.load(key).then(
      (v) => {
        this.values.set(key, v);
        this.states.set(key, 'ready');
        this.onChange();
        return v;
      },
      (err) => {
        this.states.set(key, 'failed');
        this.onChange();
        throw err;
      },
    );
    this.loads.set(key, p);
    return p;
  }

  private pump() {
    while (!this.paused && this.running < this.concurrency && this.pending.length) {
      const key = this.pending.shift()!;
      if (this.states.has(key)) continue;
      this.running++;
      void this.start(key)
        .catch(() => undefined)
        .finally(() => {
          this.running--;
          this.pump();
        });
    }
  }
}
