// The demo CEO and checklists (#612): "make me a checklist…" sends the YouTube app steps with checklist_create, "add a
// step: …" changes the newest one with checklist_update, and the wake-up after the manager ticks steps (or "how is my
// checklist?") reads it with checklist_read, like the real CEO's tools.
import { SAMPLE_STEPS } from '../checklistSample.ts';
import { registerCeoReply } from './registry.ts';

const newest = (list: string) => list.match(/^(c\d+)/m)?.[1] ?? null;

registerCeoReply('checklists', async ({ text, use }) => {
  if (/worked on their checklists/i.test(text)) {
    const id = text.match(/Checklist (c\d+)/)?.[1];
    if (!id) return null;
    const out = await use('checklist_read', { id });
    const head = out.split('\n')[0];
    return `Thanks, I see it: ${head.replace(/^c\d+ /, '')}. ${/\[ \]/.test(out) ? "I'll check back when you've done the rest." : "That's all of it, nice."}`;
  }
  if (!/\bchecklists?\b/i.test(text)) return null;
  const step = text.match(/\badd (?:a )?step:?\s*(.+)/i)?.[1]?.trim();
  const id = newest(await use('checklist_read', {}));
  if (step && id) return `${await use('checklist_update', { id, add: [{ step: { title: step.slice(0, 200) } }] })} It's at the end of the checklist.`;
  if (/\b(how|progress|status|where)\b/i.test(text) && id) {
    const out = await use('checklist_read', { id });
    return `${out.split('\n')[0].replace(/^c\d+ /, '')}. Tap the card to see each step.`;
  }
  const out = await use('checklist_create', { title: 'YouTube app · second Google account', steps: SAMPLE_STEPS });
  return out.startsWith('Created') ? 'Here are the steps as a checklist: tick each one as you go, and paste the key into its field (it goes straight to Providers).' : out;
});
