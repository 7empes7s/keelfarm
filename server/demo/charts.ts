// The demo CEO's answers to the chat's 📊 Charts prompts (#270, client/src/ui/chartPromptList.ts): live charts on the
// office's own numbers (shared/chatVisuals.ts' sources), so they show the demo's.
import { demoMoneyAnswer, demoServerAnswer } from './ceo.ts';
import { registerCeoReply } from './registry.ts';

const block = (kind: 'chart' | 'dashboard', json: object) => ['```' + kind, JSON.stringify(json), '```'].join('\n');

/** The answer to a chart prompt, or null for anything else. */
export function demoChartAnswer(text: string): string | null {
  if (/\b(money|costs?|waste)\b/i.test(text)) return demoMoneyAnswer();
  if (/\bbacklog\b/i.test(text)) return `Here's the backlog, stage by stage, across the floors.\n\n${block('chart', { type: 'stacked-bar', title: 'Backlog by stage', source: 'backlog:office' })}`;
  if (/\b(merges?|qa rounds?)\b/i.test(text))
    return `Merges and QA, live.\n\n${block('dashboard', { title: 'Merges and QA', tiles: [{ label: 'Merged today', source: 'throughput:office:mergedToday' }, { label: 'First-round QA pass', source: 'throughput:office:qaFirstPass' }, { label: 'QA rounds', source: 'throughput:office:qaRounds' }], charts: [{ type: 'bar', title: 'Merged today by floor', source: 'throughput:byFloor' }] })}`;
  if (/\busage\b/i.test(text)) return `Claude usage, against each limit.\n\n${block('chart', { type: 'progress', title: 'Claude usage', source: 'usage' })}`;
  if (/\bmemory per agent\b/i.test(text)) return `Memory per agent, live: tap one to open them.\n\n${block('chart', { type: 'bar', title: 'Memory per agent', unit: 'mb', source: 'server:byAgent' })}`;
  if (/\bserver\b/i.test(text)) return demoServerAnswer();
  return null;
}

// early: the seeded chat's attachment would otherwise turn a chart prompt into the demo's PDF report
registerCeoReply('charts', ({ text }) => demoChartAnswer(text), { early: true });
