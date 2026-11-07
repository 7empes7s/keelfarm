// Reactions (#120, shared with the CEO chat's #118): the manager's emoji on an agent's message or step, and what the
// agent is told. Only the ones that ask for something reach the session, as a short typed note; the rest are shown
// and cost nothing. Pure, for the server (the note) and the client (the bar).

/** The reaction bar, in its order. */
export const REACTIONS = ['👍', '❤️', '🎉', '👀', '🤔', '👎', '⚠️'] as const;
export type Reaction = (typeof REACTIONS)[number];

/** What each sent reaction asks the agent to do; the others need no action and aren't sent. */
const MEANING: Partial<Record<Reaction, string>> = {
  '👍': 'carry on',
  '👎': 'rethink',
  '🤔': 'explain',
  '⚠️': 'stop and check',
};

export const isReaction = (x: unknown): x is Reaction => typeof x === 'string' && (REACTIONS as readonly string[]).includes(x);

/** Whether the agent is told about this reaction (a no-action one only shows). */
export const sendsNote = (r: Reaction) => r in MEANING;

/** The note typed into the agent's session: `[manager reacted 👎 to: "I'll skip the UI test"]`; null when not sent. */
export function reactionNote(r: Reaction, quote: string): string | null {
  if (!sendsNote(r)) return null;
  const one = quote.replace(/\s+/g, ' ').replace(/"/g, "'").trim();
  const q = one.length > 90 ? `${one.slice(0, 89)}…` : one;
  return `[manager reacted ${r} to: "${q}"]`;
}

/** The agent prompt's one line on reactions (paid every session: keep it short). */
export const REACTION_PROMPT = `Reactions arrive as [manager reacted 👍 to: "…"]: ${Object.entries(MEANING)
  .map(([e, m]) => `${e} ${m}`)
  .join(', ')}.`;

/** The office's status reaction on a manager's message to an agent: 👀 seen, ⏳ working on it, ✅ answered. */
export type StatusReaction = '👀' | '⏳' | '✅';
