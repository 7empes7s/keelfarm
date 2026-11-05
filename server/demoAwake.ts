// The demo's CEO that stays awake (#28): a consult session with a canned answer, and the demo CEO's chat lines that
// try wait_for, ask_manager and consult through the real office tools.
import type { LogEntry, SessionCallbacks, SessionHandle, SessionOptions } from './agentRunner.ts';
import { NO_ANSWER } from './ceoWaits.ts';

/** A consult in the demo: a few reads, then an answer with file:line references. */
export function demoConsultSession(opts: SessionOptions, cb: SessionCallbacks): SessionHandle {
  const timers: NodeJS.Timeout[] = [];
  let done = false;
  const finish = (ok: boolean, text: string) => {
    if (done) return;
    done = true;
    for (const t of timers) clearTimeout(t);
    cb.tool(null);
    cb.finished({ ok, text, costUsd: ok ? 0.12 : 0.01, turns: 4, errors: ok ? [] : ['Stopped by manager'] });
  };
  const steps: [number, LogEntry[]][] = [
    [600, [{ kind: 'tool', tool: 'Grep', text: '⏺ Grep "approv" in src/' }, { kind: 'result', text: '  ⎿ Found 6 matches in 3 files' }]],
    [1800, [{ kind: 'tool', tool: 'Read', text: '⏺ Read src/engine/approvals.ts' }, { kind: 'result', text: '  ⎿ Read 180 lines' }]],
    [3200, [{ kind: 'thinking', text: '✻ Thinking…' }]],
  ];
  for (const [ms, entries] of steps)
    timers.push(
      setTimeout(() => {
        cb.tool(entries[0].tool ?? null);
        cb.log(entries);
      }, ms),
    );
  const answer = [
    'Approvals go through one queue: `requestApproval()` records the request and notifies the approver (src/engine/approvals.ts:42).',
    '- An approver signs off in `approve()`, which checks their role first (src/engine/approvals.ts:88).',
    '- A restore waits on that approval before it starts (src/engine/restore.ts:120); a denial ends it with the reason.',
    'Risk: approvals never expire (src/engine/approvals.ts:131), so an old one can still start a restore.',
  ].join('\n');
  timers.push(
    setTimeout(() => {
      cb.log([{ kind: 'text', text: `● ${answer}` }]);
      finish(true, answer);
    }, 4500),
  );
  if (!/read-only consult/.test(opts.prompt)) finish(false, '');
  return { send: () => undefined, stop: () => finish(false, '') };
}

type Use = (name: string, args: Record<string, unknown>) => Promise<string>;
type Floor = { floor: number; team: { size: number }; pullRequests: unknown[] };

/** The demo CEO's answer to "wait for PR #N", "consult …" or "ask me …", or null for any other message. */
export async function demoAwake(text: string, floors: Floor[], use: Use): Promise<string | null> {
  const pr = text.match(/\bwait\b.*#(\d+)/i);
  if (pr) {
    const n = Number(pr[1]);
    const f = floors.find((x) => x.pullRequests.some((p) => (p as { number?: number }).number === n)) ?? floors[0];
    if (!f) return 'There are no floors yet, so there is nothing to wait for.';
    const out = await use('wait_for', { conditions: [{ kind: 'pr_merged', floor: f.floor, pr: n }], timeout_min: 10 });
    return out.startsWith('Refused') ? `I can't wait for that: ${out.replace(/^Refused: /, '')}` : `I waited. ${out}`;
  }
  if (/\bconsult\b/i.test(text)) {
    const f = floors.find((x) => x.team.size > 0);
    if (!f) return 'No floor has agents to consult yet.';
    const out = await use('consult', { floor: f.floor, question: 'How does the restore approval flow work?', hint: 'as a security reviewer' });
    if (out.startsWith('Refused')) return `I couldn't consult anyone: ${out.replace(/^Refused: /, '')}`;
    const who = out.split('\n')[0].replace(/ says:$/, '');
    return [`${who} walked me through the restore approvals; the details are in the card. One risk: approvals never expire.`, '', `\`\`\`artifact title="Consult: ${who}"`, out, '```'].join('\n');
  }
  if (/\bask me\b/i.test(text)) {
    const out = await use('ask_manager', { question: 'Before I plan the next milestone: should the team finish the open PRs first?', suggestions: ['Yes, finish them first', 'No, plan now'], timeout_min: 30 });
    if (out === NO_ANSWER) return "I'm waiting for your answer to my question: reply to it whenever you're ready.";
    return `Thanks. ${out.replace(/^The manager answered: /, 'You said: ')}. I'll plan it that way.`;
  }
  return null;
}
