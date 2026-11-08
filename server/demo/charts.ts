// The demo CEO's answers to the chat's 📊 Charts prompts (#270, client/src/ui/chartPromptList.ts): live charts on the
// office's own numbers where a source has them (shared/chatVisuals.ts), made-up ones for the server, which has none yet.
import { demoMoneyAnswer } from './ceo.ts';
import { registerCeoReply } from './registry.ts';

const block = (kind: 'chart' | 'dashboard', json: object) => ['```' + kind, JSON.stringify(json), '```'].join('\n');

/** The answer to a chart prompt, or null for anything else. */
export function demoChartAnswer(text: string, agents: readonly string[]): string | null {
  if (/\bwaste\b/i.test(text)) return demoMoneyAnswer();
  if (/\bbacklog\b/i.test(text)) return `Here's the backlog, stage by stage, across the floors.\n\n${block('chart', { type: 'stacked-bar', title: 'Backlog by stage', source: 'backlog:office' })}`;
  if (/\b(merges?|qa rounds?)\b/i.test(text))
    return `Merges and QA, live.\n\n${block('dashboard', { title: 'Merges and QA', tiles: [{ label: 'Merged today', source: 'throughput:office:mergedToday' }, { label: 'First-round QA pass', source: 'throughput:office:qaFirstPass' }, { label: 'QA rounds', source: 'throughput:office:qaRounds' }], charts: [{ type: 'bar', title: 'Merged today by floor', source: 'throughput:byFloor' }] })}`;
  if (/\busage\b/i.test(text)) return `Claude usage, against each limit.\n\n${block('chart', { type: 'progress', title: 'Claude usage', source: 'usage' })}`;
  if (/\bmemory per agent\b/i.test(text)) {
    const names = agents.slice(0, 8);
    return `Memory per agent right now (the demo's made-up numbers).\n\n${block('chart', { type: 'bar', title: 'Memory per agent (MB)', data: names.map((label, i) => ({ label, value: 380 + ((i * 137) % 420) })) })}`;
  }
  if (/\bserver\b/i.test(text))
    return `The server is fine: memory has room and the CPU is quiet (the demo's made-up numbers).\n\n${block('dashboard', { title: 'The server', tiles: [{ label: 'Memory used', value: 61, unit: 'pct', progress: 61 }, { label: 'Swap used', value: 12, unit: 'pct', progress: 12 }, { label: 'CPU', value: 23, unit: 'pct', spark: [18, 30, 22, 41, 27, 23] }], charts: [{ type: 'donut', title: 'Memory by program (MB)', data: [{ label: 'Agents', value: 2900 }, { label: 'Office', value: 420 }, { label: 'Previews', value: 760 }, { label: 'Other', value: 540 }] }] })}`;
  return null;
}

registerCeoReply('charts', ({ text, s }) => demoChartAnswer(text, s.floors.flatMap((f) => f.agents?.map((a) => a.name) ?? [])));
