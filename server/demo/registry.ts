// The demo's registry (#257): each server/demo/<feature>.ts registers the Backend fakes it owns (and the demo CEO's
// replies that show its tools), index.ts imports them all, and createDemoBackend (demo.ts) merges them. A new feature
// adds its own module instead of editing one shared file.
import type { Backend } from '../backend.ts';
import type { DemoScale } from '../config.ts';
import type { DemoFloor, DemoStatus } from './ceo.ts';

/** What one demo office's parts share: its scale and the desks its fake sessions run in. */
export interface DemoCtx {
  scale: DemoScale | null;
  noTour: boolean;
  /** Each fake session's repo, by its desk directory. */
  deskRepo: Map<string, string>;
  /** Desks whose pretend dependencies are installed: the first task on a desk installs, the next ones skip. */
  installedDesks: Set<string>;
}

type DemoPart = (ctx: DemoCtx) => Partial<Backend>;

const parts: { name: string; part: DemoPart }[] = [];

/** A feature's fakes: the Backend members it answers, made once per demo office. */
export function registerDemo(name: string, part: DemoPart) {
  parts.push({ name, part });
}

/** The demo office's Backend: every registered part's members, each from one part only. */
export function buildDemo(ctx: DemoCtx): Backend {
  const out: Record<string, unknown> = {};
  const owner = new Map<string, string>();
  for (const { name, part } of parts) {
    for (const [key, value] of Object.entries(part(ctx))) {
      if (owner.has(key)) throw new Error(`demo: ${key} is faked by both ${owner.get(key)} and ${name}`);
      owner.set(key, name);
      out[key] = value;
    }
  }
  return out as unknown as Backend;
}

// ---------- the demo CEO's replies ----------

/** What a reply gets: the manager's words, company_status, and the demo CEO's steps through the real office tools. */
export interface CeoKit {
  text: string;
  s: DemoStatus;
  /** Calls an office tool, drawn as a step in the CEO's terminal; returns its output. */
  use: (name: string, args: Record<string, unknown>) => Promise<string>;
  /** scale_team with the call made, and a sentence on how it went. */
  scale: (f: DemoFloor, call: { size: number; reason: string }) => Promise<string>;
}

type CeoReply = (k: CeoKit) => Promise<string | null> | string | null;

const replies: { name: string; reply: CeoReply }[] = [];

/** A chat reply that shows a feature's CEO tools; the first registered one that answers (not null) wins. */
export function registerCeoReply(name: string, reply: CeoReply) {
  replies.push({ name, reply });
}

/** The first registered reply to the manager's message, or null for the demo CEO's status report. */
export async function ceoReply(k: CeoKit): Promise<string | null> {
  for (const { reply } of replies) {
    const out = await reply(k);
    if (out !== null) return out;
  }
  return null;
}
