// The demo CEO and the problems register (#544): "what are our problems?" reads the register with problems, and "note a
// problem: …" files a process problem with note_problem, like the real CEO's tools.
import { registerCeoReply } from './registry.ts';

registerCeoReply('problems', async ({ text, use }) => {
  const note = text.match(/\bnote (?:a )?problem\b:?\s*(.+)/i)?.[1]?.trim();
  if (note) {
    const out = await use('note_problem', { title: note.slice(0, 200), cause: /brief|criteria/i.test(note) ? 'vague-brief' : /check|qa/i.test(note) ? 'missing-check' : 'process' });
    return `${out} It's on the register under Settings → Problems, and in tomorrow's digest.`;
  }
  if (!/\bproblems?\b|\bwhat went wrong\b/i.test(text)) return null;
  const out = await use('problems', {});
  const [head, ...rows] = out.split('\n');
  if (!rows.length) return 'Nothing on the problems register right now.';
  return `${head}\n${rows.slice(0, 3).map((r) => `- ${r.replace(/^\S+ \[[^\]]*\] /, '')}`).join('\n')}\n\nThe whole register, grouped by cause and floor, is under Settings → Problems.`;
});
