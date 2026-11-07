// The demo CEO's reactions and quoted replies (#118), through the real react and reply tools: several messages in one
// job each get their own quoted answer; "ok thanks" gets 👍 and "go ahead" ✅, with no words (the job ends quietly).
type Use = (name: string, args: Record<string, unknown>) => Promise<string>;

const THANKS = /^(ok(ay)?|thanks?|thank you|thx|cool|great|nice|perfect|got it)\b[\s,!.]*(thanks?|thank you)?[\s!.]*$/i;
const GO = /^(go ahead|do it|ship it|sounds good,? go)\b/i;

/** The manager's messages in a chat job's text: "(message N) …" each. */
export function taggedMessages(text: string): { id: number; text: string }[] {
  return [...text.matchAll(/\(message (\d+)\) ([\s\S]*?)(?=\s*\(message \d+\) |$)/g)].map((m) => ({ id: Number(m[1]), text: m[2].split(/\s{2,}/)[0].trim() })); // a blank line ends it: the job's notes follow
}

/** The demo CEO's answer when reactions or per-message replies fit ('' = it ended with only those), else null. */
export async function demoReactions(text: string, use: Use): Promise<string | null> {
  const msgs = taggedMessages(text);
  if (msgs.length > 1) {
    for (const m of msgs) await use('reply', { message_id: m.id, text: THANKS.test(m.text) ? 'Any time.' : `On it: "${m.text.slice(0, 60)}". I'll report back here.` });
    return '';
  }
  const said = msgs[0]?.text ?? text.trim();
  if (THANKS.test(said)) return (await use('react', { emoji: '👍' })).startsWith('Refused') ? 'Any time.' : '';
  if (GO.test(said)) return (await use('react', { emoji: '✅' })).startsWith('Refused') ? 'Done.' : '';
  return null;
}
