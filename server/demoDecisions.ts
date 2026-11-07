// The demo's open decisions (#114): the CEO question a fresh demo office opens with (the team change and the charter
// change come from team.ts and demoCharters.ts, through the real paths), and the demo CEO closing one the manager
// answers in words, through the real resolve_decision tool.

/**
 * A fresh demo office's chat: questions left unanswered, then a newer message, so they wait in the tray. The first two
 * are the manager's phone in #183: no question mark, a "What you need to do:" bullet, and the newer one on the same
 * GitHub payment replacing the older.
 */
export const DEMO_DECISION_MESSAGES = [
  "GitHub Actions stopped: the account's payment failed, so every CI run on floor 3, and on floors 1 and 2, is red.\n\n- **What you need to do:** raise the spending limit for GitHub Actions in GitHub's billing settings, or drop the Windows CI job.\n```suggestions\nRaised the limit\nDrop the Windows CI job\n```",
  "Floor 3 #177 passed QA round 3, and I've escalated it to you. The team card now opens that floor's team, the back buttons work, and a new test guards the earlier bug. The only blocker left is the failed GitHub payment.\n```suggestions\n? Did you raise the limit, or shall I drop the Windows CI job?\nI fixed the payment\nSkip Windows CI for now\n```",
  'The memory alert fired three times today while two builds ran together. Shall I file the quieter memory alert fix, or lower the margin?\n```suggestions\nFile the quieter alert fix\nLower the margin\nLeave it as it is\n```',
  'Morning report: every floor is busy, and nothing is stuck. Your open questions wait above the message box.',
];

/**
 * #208's phone (msg 1048, 1049, 1052): the CEO asks about three fixes, asks about the third again, and the manager
 * answers the first: both close, and the decision log says "Replied to message …".
 */
export const DEMO_REASK = {
  ask: 'Three small fixes came up on floor 1: A, the flaky upload test; B, the retry button on PR cards; C, a dark mode toggle for the console. Shall I file all three?\n```suggestions\nYes, file all three\nOnly A and B\nNot now\n```',
  reAsk: 'Should I also file C, the dark mode toggle for the console on floor 1?\n```suggestions\nYes, file C\nNot now\n```',
  answer: 'Yes, file all three',
};

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
