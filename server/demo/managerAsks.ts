// The demo CEO does what the manager tells it in chat (#403): "start the experiment", "send back #3", "merge #3",
// "turn on auto-merge", "prioritise #4", "use Sonnet", "update the office", "set floor 1's focus to …", each through the real tool with
// asked_in, so the card names the message and Undo works as in the real office.
import type { DemoStatus } from './ceo.ts';
import { refused } from './ceo.ts';
import { registerCeoReply } from './registry.ts';

/** The manager's message the job carries: "(message N) …". */
const askedIn = (text: string) => Number(text.match(/\(message (\d+)\)/)?.[1] ?? NaN);

const floorOf = (s: DemoStatus, text: string, has: (f: DemoStatus['floors'][number]) => boolean = () => false) =>
  s.floors.find((f) => new RegExp(`\\bfloor ${f.floor}\\b`, 'i').test(text)) ?? s.floors.find(has) ?? s.floors[0];

const said = (out: string, done: string, what: string) => (out.startsWith('Refused') ? `I couldn't ${what}: ${refused(out)}` : `${done} ${out}`);

registerCeoReply('manager asks', async ({ text, s, use }) => {
  const asked_in = askedIn(text);
  if (!Number.isInteger(asked_in)) return null;
  const experiment = text.match(/\b(start|stop)\b[^.?!]*\bexperiment\b/i);
  if (experiment) {
    const action = experiment[1].toLowerCase() as 'start' | 'stop';
    const lines = ((s.company as { experiments?: string[] }).experiments ?? []).filter((l) => (action === 'start' ? / \((draft|stopped)/ : / \(running/).test(l));
    const id = lines[0]?.match(/\[([\w-]+)\]$/)?.[1];
    if (!id) return `There is no experiment to ${action} right now.`;
    return said(await use('run_experiment', { experiment: id, action, asked_in }), 'Done, as you asked:', `${action} it`);
  }
  const pr = text.match(/\b(send back|retry qa on|merge)\b(?: pr)? #(\d+)|\bsend (?:pr )?#(\d+) back\b/i);
  if (pr) {
    const n = Number(pr[2] ?? pr[3]);
    const floor = floorOf(s, text, (f) => f.pullRequests.some((p) => p.number === n)).floor;
    const verb = (pr[1] ?? 'send back').toLowerCase();
    const [tool, args] = verb === 'merge' ? ['merge_pull', {}] : verb === 'retry qa on' ? ['retry_qa', {}] : ['send_back', { note: 'The manager asked: bring it up to date with main and recheck the phone layout.' }];
    return said(await use(tool, { floor, pr: n, asked_in, ...args }), 'Done, as you asked:', `${verb} #${n}`);
  }
  if (/\b(update the office|apply the update)\b/i.test(text)) return said(await use('apply_update', { asked_in }), 'On it:', 'update the office');
  const sw = text.match(/\bturn (on|off) auto-?(merge|assign)\b/i);
  if (sw) {
    const floor = floorOf(s, text).floor;
    return said(await use('set_floor_switches', { floor, [`auto_${sw[2].toLowerCase()}`]: sw[1].toLowerCase() === 'on', asked_in }), 'Done:', 'change it');
  }
  const issue = text.match(/\b(prioriti[sz]e|park)\b #(\d+)/i);
  if (issue) {
    const n = Number(issue[2]);
    const floor = floorOf(s, text, (f) => f.backlog.some((i) => i.number === n)).floor;
    return said(await use('set_issue_priority', { floor, number: n, ...(/^park/i.test(issue[1]) ? { parked: true } : { priority: true }), asked_in }), 'Done:', `change #${n}`);
  }
  const model = text.match(/\buse (opus|sonnet)\b/i);
  if (model) return said(await use('set_ceo_setup', { model: model[1].toLowerCase() === 'opus' ? 'claude-opus-5-5' : 'claude-sonnet-5', asked_in }), 'Done:', 'switch');
  const focus = text.match(/\bfocus to (.+)$/i);
  if (focus) {
    const floor = floorOf(s, text).floor;
    return said(await use('apply_charter', { floor, focus: focus[1].trim().slice(0, 120), reason: 'The manager asked for this focus.', asked_in }), 'Done:', 'change the charter');
  }
  return null;
}, { early: true });
