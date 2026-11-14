// The Researcher in the demo (#664): "ask Sage to look into <topic>" makes the demo CEO hand it over with
// request_research through the real tool; the Researcher's session is the demo CEO's research script (ceo.ts), so a
// fake brief arrives as a card about 20 s later while the CEO's chat stays free.
import { RESEARCHER_NAME } from '../../shared/research.ts';
import { refused } from './ceo.ts';
import { registerCeoReply } from './registry.ts';

const ASK = new RegExp(`\\b(?:ask ${RESEARCHER_NAME}|ask the researcher)\\b(?: to)?(?: look into| research| find out about)?\\s*(.+)`, 'i');

registerCeoReply('request_research', async ({ text, s, use }) => {
  const topic = text.match(ASK)?.[1]?.trim().replace(/[.?!]+$/, '');
  if (!topic) return null;
  const floor = s.floors.find((f) => text.includes(`floor ${f.floor}`))?.floor;
  const out = await use('request_research', { topic, ...(floor && { floor }), questions: ['What do comparable products do?', 'What would it take here?'] });
  return out.startsWith('Refused') ? `I couldn't hand it over: ${refused(out)}` : `Handed to ${RESEARCHER_NAME}: "${topic}". Their brief comes to you here, and back to me to plan from. I'm free meanwhile.`;
});
