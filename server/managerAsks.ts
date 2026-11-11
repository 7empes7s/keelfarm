// The CEO does what the manager tells it in chat (#403): a CEO tool that is normally the manager's runs only when the
// manager's own message, delivered to the CEO in its current job, asks for it (the call names it in asked_in), and
// never for what only the manager may ever do. Pure: the swarm (server/swarm/managerAsks.ts) passes in what it knows.

/** How old the message a call names may be. */
export const ASKED_IN_MAX_MS = 4 * 3_600_000;

/** Manager messages a CEO job keeps as its askers, newest last. */
export const HEARD_MAX = 50;

/** The message a manager-only call names. heard: the manager's messages delivered to the CEO in its current job. */
export function askedInRefusal(o: { askedIn: unknown; heard: readonly number[]; messages: readonly { id: number; from: string; at: number }[]; now: number }): string | null {
  const id = Number(o.askedIn);
  if (o.askedIn == null || !Number.isInteger(id)) return 'Only the manager can ask for this: pass asked_in, the number of their message that asks for it (the N of "(message N)").';
  const m = o.messages.find((x) => x.id === id);
  if (!m) return `There is no message #${id} in the chat.`;
  if (m.from !== 'manager') return `#${id} isn't the manager's message: only their own words can ask for this.`;
  if (!o.heard.includes(id)) return `The manager's #${id} didn't come to you in this job: only a message they sent you now can ask for this. Suggest it in your reply instead.`;
  if (o.now - m.at > ASKED_IN_MAX_MS) return `#${id} is over ${ASKED_IN_MAX_MS / 3_600_000} hours old: ask the manager again before doing it.`;
  return null;
}

/** The manager's messages a CEO job may act on: a chat job's own, nothing for the jobs the office starts. */
export const heardAtStart = (job: { kind: string; messageIds?: number[] }): number[] => (job.kind === 'chat' ? [...(job.messageIds ?? [])].slice(-HEARD_MAX) : []);

/** What stays the manager's alone, even when they ask: each with where they do it themselves. */
const NEVER: { test: RegExp; why: string }[] = [
  { test: /\/root\/(Projects\/)?keelfarm\b|\b(4317|5317)\b/i, why: 'it touches the live office (/root/Projects/keelfarm, port 4317). Only you can do that, from a terminal on the server' },
  { test: /\bforce[- ]?push|\bpush\b[^\n]{0,40}\s(-f|--force)\b/i, why: 'only you can force-push, from your own git' },
  { test: /\b(delete|remove)\b[^\n]{0,30}\b(repo|repository|branch(es)?)\b|\bgh repo delete\b|\bpush\b[^\n]{0,40}--delete\b/i, why: 'only you can delete repositories or branches, on GitHub' },
  { test: /\b(show|reveal|print|send|paste)\b[^\n]{0,30}\b(secrets?|api[ _-]?keys?|tokens?|passwords?)\b/i, why: 'secrets stay hidden. Only you can see them, in Settings → Providers' },
  { test: /\b(M365|Microsoft 365|Entra)\b[^\n]{0,40}\btenant\b|\bconditional access\b/i, why: 'only you can write to the live M365 tenant' },
];

/** Why a manager-only call stays refused whatever the manager said, or null. Every string in its arguments is read. */
export function neverAllowed(args: unknown): string | null {
  const text = strings(args).join('\n');
  const hit = NEVER.find((n) => n.test.test(text));
  return hit ? `Never from the CEO: ${hit.why}.` : null;
}

function strings(v: unknown): string[] {
  if (typeof v === 'string') return [v];
  if (Array.isArray(v)) return v.flatMap(strings);
  if (v && typeof v === 'object') return Object.values(v).flatMap(strings);
  return [];
}

/** A charter change applied when the manager asks: the standards that protect the live office stay word for word. */
export function liveStandardsRefusal(before: readonly string[], after: readonly string[]): string | null {
  const lost = before.filter((s) => NEVER[0].test.test(s) && !after.includes(s));
  return lost.length ? `Never from the CEO: "${lost[0].slice(0, 80)}" protects the live office, so it stays as it is. Only you can change it, in the console's Charter tab.` : null;
}
