// The demo's setup advisor (#366): the company makes web apps and APIs, a three.js game waits to be moved in (its
// checklist shows), floor 2 has an OpenCode agent on Gemini whose demo key is turned away (its Sign in card), and the
// demo CEO applies a recommendation through the real apply_setup tool when asked.
import { refused, type DemoFloor } from './ceo.ts';
import { registerCeoReply, registerDemo } from './registry.ts';

registerDemo('setup', () => ({
  demoSetup: () => ({ company: ['web-app', 'api'], spare: ['demo-co/star-hopper'], signedOut: { floor: 2, model: 'google/gemini-2.5-pro' } }),
}));

// "apply the setup recommendation on floor 4": the first gap the office can fix by itself there.
registerCeoReply('apply_setup', async ({ text, s, use }) => {
  if (!/\b(set ?up|recommend\w*)\b/i.test(text) || !/\b(apply|fix|use)\b/i.test(text)) return null;
  const floors = s.floors as (DemoFloor & { setup?: string })[];
  const gapsOf = (f: DemoFloor & { setup?: string }) => [...(f.setup ?? '').matchAll(/(?:: |; )([\w:-]+) \(/g)].map((m) => m[1]).filter((g) => !/^(signin|provider):/.test(g));
  const n = Number(/\bfloor (\d+)/i.exec(text)?.[1]);
  const f = floors.find((x) => x.floor === n) ?? floors.find((x) => gapsOf(x).length);
  const gap = f && gapsOf(f)[0];
  if (!f || !gap) return 'Every floor is set up as recommended, apart from sign-ins and keys: those need you, from the floor’s setup card.';
  const out = await use('apply_setup', { floor: f.floor, gap });
  return out.startsWith('Refused') ? `I couldn't apply it: ${refused(out)}` : `Done. ${out}`;
});
