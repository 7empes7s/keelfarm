// What holds the CEO's tool calls open (#28): wait_for's waits, checked every few seconds until one holds or times
// out, and ask_manager's questions, open until the manager answers. Nothing here is saved: a restart ends the CEO's
// session, and a later reply to a question comes back as an ordinary chat job with its quote.
import { NO_ANSWER, routeReply, type CeoQuestion } from './ceoWaits.ts';

const QUESTIONS_KEPT = 20;

interface Hold {
  label: string;
  check: () => string | null;
  done: (text: string) => void;
  question?: CeoQuestion;
}

export class CeoHolds {
  readonly questions: CeoQuestion[] = [];
  private holds = new Set<Hold>();
  private ticker: NodeJS.Timeout | null = null;

  /** changed: what the CEO waits on changed (the CEO tab shows it). */
  constructor(
    private changed: () => void,
    private tickMs = 3000,
  ) {}

  /** What the CEO waits on, for the CEO tab; null when nothing. */
  waiting(): string | null {
    return [...this.holds].map((h) => h.label).join('; ') || null;
  }

  /** Wait until `check` says what happened, or `ms` passes ("timed out"). */
  wait(label: string, check: () => string | null, ms: number): Promise<string> {
    const now = check();
    if (now !== null) return Promise.resolve(now);
    return this.hold(label, check, ms, () => `Timed out after ${Math.round(ms / 60_000)} min: still waiting for ${label}.`);
  }

  /** ask_manager: hold until answer(q.id) or `ms` passes, then the question stays for a reply that resumes it. */
  ask(q: CeoQuestion, ms: number): Promise<string> {
    this.questions.push(q);
    this.questions.splice(0, Math.max(0, this.questions.length - QUESTIONS_KEPT));
    return this.hold('your answer', () => null, ms, () => {
      q.waiting = false;
      return NO_ANSWER;
    }, q);
  }

  /**
   * A manager's message for a question (routeReply): the waiting session gets it as the answer, or (resume) nobody
   * waits on it any more and it starts a new job. Null: it answers no question.
   */
  answer(replyTo: number | undefined, text: string): { to: CeoQuestion; resume: boolean } | null {
    const r = routeReply(this.questions, replyTo);
    if (!r || r.resume) return r;
    r.to.waiting = false;
    [...this.holds].find((h) => h.question === r.to)?.done(`The manager answered: ${text}`);
    return r;
  }

  /** End every wait and question now (the office drains for an update, or the CEO's session ended). */
  cancel(why: string) {
    for (const h of this.holds) h.done(why); // deleting the one being visited is safe in a Set
    for (const q of this.questions) q.waiting = false;
  }

  /** Look at every wait again. */
  check() {
    for (const h of this.holds) {
      const met = h.check();
      if (met !== null) h.done(met);
    }
  }

  private hold(label: string, check: () => string | null, ms: number, timedOut: () => string, question?: CeoQuestion): Promise<string> {
    return new Promise((resolve) => {
      const h: Hold = { label, check, question, done: () => undefined };
      const timer = setTimeout(() => h.done(timedOut()), ms);
      h.done = (text) => {
        clearTimeout(timer);
        if (!this.holds.delete(h)) return;
        if (!this.holds.size && this.ticker) clearInterval(this.ticker);
        if (!this.holds.size) this.ticker = null;
        this.changed();
        resolve(text);
      };
      this.holds.add(h);
      this.ticker ??= setInterval(() => this.check(), this.tickMs);
      this.changed();
    });
  }
}
