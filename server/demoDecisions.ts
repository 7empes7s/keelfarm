// The demo's open decisions (#114): the CEO question a fresh demo office opens with (the team change and the charter
// change come from team.ts and demoCharters.ts, through the real paths), and the demo CEO closing one the manager
// answers in words, through the real resolve_decision tool.

/** A fresh demo office's chat: a question left unanswered, then a newer message, so it waits in the tray. */
export const DEMO_DECISION_MESSAGES = [
  'The memory alert fired three times today while two builds ran together. Shall I file the quieter memory alert fix, or lower the margin?\n```suggestions\nFile the quieter alert fix\nLower the margin\nLeave it as it is\n```',
  'Morning report: every floor is busy, and nothing is stuck. Your open questions wait above the message box.',
];

/** An open decision in company_status, as far as the demo CEO reads it. */
interface OpenDecision {
  id: string;
  question: string;
}

const words = (s: string) => new Set(s.toLowerCase().match(/\p{L}{6,}/gu) ?? []);

/** The manager answered one of the CEO's open questions in words (they share a long word with it): the demo CEO closes it. */
export async function demoResolve(text: string, open: readonly OpenDecision[] | undefined, use: (tool: string, args: Record<string, unknown>) => Promise<string>): Promise<string | null> {
  const said = words(text);
  const d = open?.find((x) => x.id.startsWith('msg:') && [...words(x.question)].some((w) => said.has(w)));
  if (!d) return null;
  const out = await use('resolve_decision', { id: d.id, outcome: text.trim().slice(0, 200) });
  return out.startsWith('Refused') ? null : `Got it: I closed "${d.question}" with your answer, so it leaves your tray.`;
}
