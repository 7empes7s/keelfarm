// The demo CEO's side of #330: a full session's handover, and a chat that still knows what its latest background job
// did, read from the digest or the "since your last chat" line the office put in the prompt.
const JOB_LINE = /(?:Since your last chat, your background job|Your latest background job) \(([^)]+)\)(?: said)?:\s*([^\n]*)((?:\n- [^\n]+)*)/;

/** The latest background job in a CEO prompt: its label, what it said and the issues it filed; null without one. */
function backgroundJobIn(prompt: string): { label: string; said: string; issues: string[] } | null {
  const m = prompt.match(JOB_LINE);
  return m ? { label: m[1], said: m[2].trim(), issues: m[3].split('\n- ').map((l) => l.trim()).filter(Boolean) } : null;
}

/** The demo CEO's reply to "what did the review do?": from the prompt, as a chat with no memory of it would not know. */
export function demoJobReply(text: string, prompt: string): string | null {
  const job = backgroundJobIn(prompt);
  if (!job || !/\b(review|follow-?up|triage|background|last job|what did you( just)? do)\b/i.test(text)) return null;
  return [`From my last background job (${job.label.toLowerCase()}): ${job.said}`, ...job.issues.map((t) => `- ${t}`)].join('\n');
}

export const DEMO_HANDOVER = 'In flight: the company review I just ran and any PRs waiting for QA. The manager is waiting for nothing from me right now. Promises: none open.';
