// A Jarvis call's echo (#682, msg 4563): the agent's own voice from the speaker, heard back by the mic and transcribed
// as the manager's words. Pure: a finished transcript that matches what the agent is saying or just said is dropped,
// and the mic's processing the browser didn't apply is named for the trace.

const NUMBERS: Record<string, string> = { zero: '0', one: '1', two: '2', three: '3', four: '4', five: '5', six: '6', seven: '7', eight: '8', nine: '9', ten: '10' };

const norm = (t: string) =>
  t
    .toLowerCase()
    .replace(/['’]/g, '')
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
    .map((w) => NUMBERS[w] ?? w);

/** Share of a transcript's words found in a reply for it to be the reply's echo (recognition misses a word or two). */
const ECHO_SHARE = 0.8;

/** Whether `heard` is the agent's own speech: most of its words are in one of `replies` (the current and last reply). */
export function echoOf(heard: string, replies: readonly string[]): boolean {
  const w = norm(heard);
  if (!w.length) return false;
  return replies.some((r) => {
    const said = new Set(norm(r));
    return said.size > 0 && w.filter((x) => said.has(x)).length / w.length >= ECHO_SHARE;
  });
}

/** The mic processing a call asks for that the browser didn't apply (its track's getSettings()). */
export function micProcessingOff(s: { echoCancellation?: boolean | string; noiseSuppression?: boolean; autoGainControl?: boolean }): string[] {
  return (['echoCancellation', 'noiseSuppression', 'autoGainControl'] as const).filter((k) => s[k] !== true && !(typeof s[k] === 'string' && s[k] !== 'none')); // newer browsers: echoCancellation 'all' | 'remote-only'
}
