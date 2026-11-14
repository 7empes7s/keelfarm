// The CEO's steps in plain words (#150): one sentence per tool call, with what it touched ("Reading PR #122's changes on
// floor 3", "Waiting for PR #138 to merge on floor 3 (up to 10 min)"), shared by the working strip, the typing bubble
// and each reply's step log. Built from the call's log line (server/agentRunner.ts describeTool), which every runtime
// writes. Secrets are masked and nothing shows a raw tool name or agent id. Pure.
import { redact } from './activity.ts';
import { connectorName } from './used.ts';

export interface StepWords {
  icon: string;
  text: string;
}

/** An agent's name for an id the CEO passed (null: not one the office knows). */
export type NameOf = (id: string) => string | null;

const TEXT_MAX = 90;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const clip = (s: string, n = TEXT_MAX) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);
const quoted = (s: string) => `“${clip(s.trim(), 50)}”`;

/** What a call's log line names: its floor, PR, issue, agent and quoted text. */
interface Target {
  floor: number | null;
  pr: number | null;
  num: number | null;
  agent: string | null;
  quote: string | null;
  rest: string; // the line after the tool's name
}

function target(rest: string): Target {
  const n = (re: RegExp) => {
    const m = rest.match(re);
    return m ? Number(m[1]) : null;
  };
  return {
    floor: n(/\bfloor (\d+)\b/) ?? n(/"floor":(\d+)/),
    pr: n(/\bPR #(\d+)/) ?? n(/"pr":(\d+)/),
    num: n(/(?<!PR )#(\d+)/) ?? n(/"(?:number|issue)":(\d+)/),
    agent: rest.match(/"agent_id":"([^"]+)"/)?.[1] ?? null,
    quote: rest.match(/"([^"]+)"/)?.[1] ?? null,
    rest,
  };
}

/** " on floor 3", or nothing. */
const onFloor = (t: Target) => (t.floor ? ` on floor ${t.floor}` : '');
/** "PR #12" / "#12" / fallback. */
const pr = (t: Target, none = 'a pull request') => (t.pr ? `PR #${t.pr}` : none);
const issue = (t: Target, none = 'an issue') => (t.num ? `#${t.num}` : none);

/** An agent as people know them: their name, else what the CEO wrote unless it's an id. */
function who(id: string | null, nameOf: NameOf | undefined, none = 'an agent'): string {
  if (!id) return none;
  return nameOf?.(id) ?? (UUID.test(id) || id.length > 30 ? none : id);
}
const whose = (name: string) => (name === 'an agent' ? "an agent's" : `${name}'s`);

/** wait_for's line: "pr_merged floor 3 PR #138 or agent_idle <id> · up to 10 min". */
function waitWords(rest: string, nameOf?: NameOf): string {
  const [conds, timeout] = rest.split(' · ');
  const list = conds.split(' or ').map((c) => c.trim()).filter(Boolean);
  const first = list[0] ?? '';
  const kind = first.split(' ')[0];
  const t = target(first);
  const agent = who(first.split(' ')[1] ?? null, nameOf);
  const what: Record<string, string> = {
    pr_qa: `QA's verdict on ${pr(t)}${onFloor(t)}`,
    pr_merged: `${pr(t)} to merge${onFloor(t)}`,
    issue_closed: `${issue(t)} to close${onFloor(t)}`,
    agent_idle: `${agent} to finish`,
    preview_running: `${t.floor ? `floor ${t.floor}'s` : 'a'} preview`,
    usage: `Claude's usage to be ${first.split(' ')[1] ?? 'normal'}`,
  };
  const more = list.length > 1 ? ` or ${list.length - 1} more` : '';
  const mins = timeout?.match(/(\d+) min/)?.[1];
  return `Waiting for ${what[kind] ?? 'something to happen'}${more}${mins ? ` (up to ${mins} min)` : ''}`;
}

type Words = (t: Target, nameOf?: NameOf) => string;

// Every office tool and CEO tool (server/ceo.ts; a test checks the list), its icon and sentence.
const OFFICE: Record<string, [string, Words]> = {
  company_status: ['🏢', () => 'Checking the floors'],
  floor_detail: ['📋', (t) => `Reading ${t.floor ? `floor ${t.floor}'s` : "a floor's"} charter and playbook`],
  agent_detail: ['🔎', (t, n) => `Checking on ${who(t.agent ?? t.rest.split(' ')[0], n)}`],
  agent_log: ['📜', (t, n) => `Reading ${whose(who(t.agent ?? t.rest.split(' ')[0], n))} log`],
  set_floor_profile: ['🗂️', (t) => `Updating ${t.floor ? `floor ${t.floor}'s` : "a floor's"} profile`],
  set_office_playbook: ['📘', () => 'Updating the office playbook'],
  apply_setup: ['🧭', (t) => `Setting up ${t.floor ? `floor ${t.floor}` : 'a floor'} as recommended`],
  scale_team: ['👥', (t) => `Sizing ${t.floor ? `floor ${t.floor}'s` : 'a'} team${t.rest.match(/→ (\d+)/) ? ` to ${t.rest.match(/→ (\d+)/)![1]}` : ''}`],
  configure_agent: ['⚙️', (t, n) => `Setting up ${who(t.agent ?? t.rest.split(/[\s:]/)[0], n)}`],
  file_issue: ['📝', (t) => `Filing an issue${onFloor(t)}${t.quote ? `: ${quoted(t.quote)}` : ''}`],
  set_dependencies: ['🔗', (t) => `Ordering ${issue(t)}${onFloor(t)}`],
  close_issue: ['🗂️', (t) => `Closing ${issue(t)}${onFloor(t)}`],
  retry_qa: ['🔍', (t) => `Sending ${pr(t)} back to QA${onFloor(t)}`],
  send_back: ['↩️', (t) => `Sending ${pr(t)} back for a fix${onFloor(t)}`],
  rerun_checks: ['🔁', (t) => `Re-running ${pr(t)}'s checks${onFloor(t)}`],
  close_pull: ['✖️', (t) => `Closing ${pr(t)}${onFloor(t)}`],
  merge_pull: ['🔀', (t) => `Merging ${pr(t)}${onFloor(t)}`],
  apply_update: ['⬆️', () => 'Updating the office as you asked'],
  set_issue_priority: ['⭐', (t) => `Reprioritising ${issue(t)}${onFloor(t)}`],
  set_floor_switches: ['🎛️', (t) => `Changing ${t.floor ? `floor ${t.floor}'s` : "a floor's"} switches`],
  apply_charter: ['🧭', (t) => `Changing ${t.floor ? `floor ${t.floor}'s` : "a floor's"} charter`],
  run_experiment: ['🧪', () => 'Running an experiment as you asked'],
  set_ceo_setup: ['⚙️', () => 'Changing my own setup'],
  escalate: ['🚩', (t) => `Escalating ${pr(t)}${onFloor(t)}`],
  attach_file: ['📎', (t) => (t.rest ? `Attaching ${clip(t.rest, 50)}` : 'Attaching a file')],
  keep_file: ['📌', () => 'Keeping a file'],
  set_mandate: ['📜', () => 'Setting a mandate'],
  propose_charter: ['🧭', (t) => `Proposing a charter${t.floor ? ` for floor ${t.floor}` : ''}`],
  propose_design: ['🎨', (t) => `Showing you design options${t.floor ? ` for floor ${t.floor}` : ''}`],
  resolve_decision: ['✅', () => 'Settling a decision'],
  define_experiment: ['🧪', () => 'Setting up an experiment'],
  restart_agent: ['🔄', (t, n) => `Restarting ${who(t.agent, n)}`],
  stop_agent: ['⏹️', (t, n) => `Stopping ${who(t.agent, n)}`],
  message_agent: ['💬', (t, n) => `Messaging ${who(t.agent, n)}`],
  assign_issue: ['📌', (t, n) => {
    const name = t.rest.split(' · ')[1]?.trim();
    return `Putting ${!name || name === 'next free' ? 'the next free agent' : who(name, n)} on ${issue(t)}${onFloor(t)}`;
  }],
  answer_agent: ['💬', (t, n) => `Answering ${who(t.agent ?? t.rest.split(/[\s:]/)[0], n)}`],
  ask_manager_choice: ['❓', (t, n) => `Asking you to decide for ${who(t.agent ?? t.rest.split(/[\s:]/)[0], n)}`],
  qa_report: ['🧪', (t) => `Reading ${pr(t)}'s QA report${onFloor(t)}`],
  worktree_file: ['📂', (t, n) => `Looking at ${whose(who(t.agent ?? t.rest.split(' ')[0], n))} work`],
  pr_diff: ['🔀', (t) => `Reading ${pr(t)}'s changes${onFloor(t)}`],
  session_history: ['🕘', () => 'Reading past sessions'],
  send_telegram: ['✈️', () => 'Sending to Telegram'],
  scan_keys: ['🔑', () => 'Looking for keys left on this computer'],
  it_run: ['🖥️', () => 'Checking this machine'],
  it_propose: ['🖥️', () => 'Asking you to run a command'],
  it_runbook: ['📋', () => 'Running a runbook as one job'],
  it_health: ['🖥️', () => "Reading the office's health"],
  ask_it: ['🖥️', () => 'Asking IT'],
  request_research: ['🔎', () => 'Handing research to the Researcher'],
  create_floor: ['🏗️', () => 'Opening a new floor'],
  agency_opportunities: ['💼', (t) => `Ranking opportunities${onFloor(t)}`],
  agency_decide: ['💼', () => 'Recording your answer'],
  agency_propose_action: ['✋', () => 'Asking your OK before anything goes out'],
  agency_action_done: ['💼', () => 'Marking an approved action done'],
  cloudflare: ['☁️', () => 'Working on Cloudflare'],
  provider_action: ['🔑', () => "Using a provider's key"],
  install_key: ['🔑', () => 'Installing a key into a service'],
  save_provider_key: ['🔑', () => 'Saving a key in Providers'],
  it_report: ['🖥️', () => 'Reporting a problem to IT'],
  it_ticket: ['🖥️', () => 'Answering an IT ticket'],
  problems: ['📋', () => 'Reading the problems register'],
  note_problem: ['📋', () => 'Noting a problem on the register'],
  checklist_create: ['☑️', () => 'Making you a checklist'],
  checklist_update: ['☑️', () => 'Changing a checklist'],
  checklist_read: ['☑️', () => 'Reading a checklist'],
  make_default_account: ['🔀', () => 'Changing the default account'],
  edit_message: ['✏️', () => 'Correcting an earlier reply'],
  react: ['👍', () => 'Reacting to your message'],
  reply: ['↩️', () => 'Answering a message'],
  wait_for: ['⏳', (t, n) => waitWords(t.rest, n)],
  ask_manager: ['❓', (t) => `Asking you${t.rest.replace(/^:\s*/, '') ? `: ${quoted(t.rest.replace(/^:\s*/, ''))}` : ' a question'}`],
  consult: ['🧑‍💻', (t, n) => {
    const name = who(t.rest.match(/^floor \d+ ([^:\s]+):/)?.[1] ?? null, n, '');
    return `Asking ${name || (t.floor ? `floor ${t.floor}'s team` : 'a teammate')} about ${t.floor ? `floor ${t.floor}'s` : 'the'} code`;
  }],
};

/** The office and CEO tools the words cover (for the test over server/ceo.ts's list). */
export const STEP_TOOLS = Object.keys(OFFICE);

/** "some_new_tool" / "someNewTool" → "some new tool". */
const words = (name: string) => name.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ').trim().toLowerCase();

const host = (url: string) => url.match(/^\(?(?:https?:\/\/)?([^/\s)]+)/)?.[1] ?? '';

/** A built-in tool's words from its log line (after "⏺ "). */
function builtIn(tool: string, line: string): StepWords | null {
  const arg = line.match(/^[\w ]+?(?:\(|\s)(.*)$/)?.[1].replace(/\)$/, '').trim() ?? ''; // "Read a.ts" / "Update(a.ts)" → "a.ts"
  const notes = /NOTES\.md/i.test(line);
  const q = line.match(/"([^"]+)"/)?.[1];
  switch (tool) {
    case 'Read':
      return { icon: '📖', text: notes ? 'Reading its notes' : arg ? `Reading ${clip(arg, 60)}` : 'Reading a file' };
    case 'Write':
    case 'Edit':
    case 'MultiEdit':
    case 'NotebookEdit':
      return { icon: '✏️', text: notes ? 'Updating its notes' : arg ? `${tool === 'Write' ? 'Writing' : 'Editing'} ${clip(arg, 60)}` : 'Writing a file' };
    case 'Grep':
      return { icon: '🔎', text: q ? `Searching the code for ${quoted(q)}` : "Searching the office's code" };
    case 'Glob':
      return { icon: '🗂️', text: arg ? `Looking for files: ${clip(arg, 50)}` : 'Looking for files' };
    case 'WebSearch':
      return { icon: '🌐', text: q ? `Searching the web: ${clip(q, 60)}` : 'Searching the web' };
    case 'WebFetch':
      return { icon: '🌐', text: host(arg) ? `Reading ${host(arg)}` : 'Reading a web page' };
    case 'Bash':
    case 'PowerShell': {
      const cmd = line.replace(/^\$\s*/, '').trim();
      return { icon: '⌨️', text: cmd && line.startsWith('$') ? `Running ${clip(cmd, 50)}` : 'Running a command' };
    }
    case 'TodoWrite':
      return { icon: '📋', text: 'Planning' };
    case 'Task':
    case 'Agent': {
      const d = line.replace(/^Subagent:\s*/, '').trim();
      return { icon: '🤝', text: d && d !== line ? `Asking a helper: ${clip(d, 60)}` : 'Asking a helper' };
    }
    case 'Skill':
      return { icon: '✨', text: arg ? `Using the ${clip(arg, 40)} skill` : 'Using a skill' };
    case 'ToolSearch':
      return { icon: '🧰', text: 'Loading tools' };
  }
  return null;
}

/**
 * A tool call in plain words. `detail`: its log line, e.g. "⏺ 🔀 pr_diff PR #12 → floor 3"; `nameOf`: agents' names for
 * the ids the CEO passes. Unknown tools get a cleaned name, never a raw one.
 */
export function stepWords(tool: string, detail = '', nameOf?: NameOf): StepWords {
  const line = redact(detail.replace(/^\s*⏺\s*/, '').trim()); // masked before anything is cut, so no half secret is left
  const office = tool.match(/^mcp__office__(\w+)$/);
  let out: StepWords;
  if (office) {
    const name = office[1];
    const rest = line.replace(new RegExp(`^.*?\\b${name}\\b\\s*`), '').trim();
    const def = OFFICE[name];
    out = def ? { icon: def[0], text: def[1](target(rest), nameOf) } : { icon: '🏢', text: words(name).replace(/^./, (c) => c.toUpperCase()) };
  } else if (tool.startsWith('mcp__playwright__')) {
    out = { icon: '🌐', text: 'Using the browser' };
  } else {
    const mcp = tool.match(/^mcp__(.+?)__/);
    out = builtIn(tool, line) ?? (mcp ? { icon: '🔌', text: `Using ${connectorName(mcp[1])}` } : { icon: '🛠', text: `Using ${words(tool) || 'a tool'}` });
  }
  return { icon: out.icon, text: clip(out.text) };
}

/** A filed issue's step once the office answered: "Filed floor 3 #149" (null: not a filed issue). */
export function filedWords(result: string, floor: number | null): string | null {
  const m = result.match(/Filed #(\d+)(?: on floor (\d+))?/);
  if (!m) return null;
  const f = m[2] ?? floor;
  return `Filed ${f ? `floor ${f} ` : ''}#${m[1]}`;
}

/** A result or error line as a step's note: without the "⎿", masked, short. */
export const stepNote = (text: string, max = 100) => clip(redact(text.replace(/^\s*⎿\s*/, '').split('\n')[0].trim()), max);

/** "0.8 s", "42 s", "3 min", "1 h 5 min". */
export function shortDuration(ms: number): string {
  const s = Math.max(0, ms) / 1000;
  if (s < 10) return `${s.toFixed(1)} s`;
  if (s < 60) return `${Math.floor(s)} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ''}`;
}
