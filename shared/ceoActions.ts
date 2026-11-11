// What a CEO reply did (#108): the office tools it called that change something, as compact cards under the message
// (an icon, the result in one line, and what a tap opens and the live status follows). Built from the job's recorded
// calls (server/ceoChat.ts), so it costs the CEO nothing. Read-only tools stay in the "Steps" fold. Pure.
import type { OfficeCall } from './ceoStream.ts';

/** A console section an action card opens (ids from client/src/ui/consoleNavRules.ts). */
type ActionSection = 'team' | 'ceo' | 'charter' | 'ops' | 'projects' | 'notifications' | 'providers' | 'accounts';

/** What an action card opens, and whose live status it shows. */
export type ActionRef =
  | { kind: 'issue'; repoId: string; number: number }
  | { kind: 'qa'; repoId: string; number: number } // retry_qa's: its QA report (#151)
  | { kind: 'floor'; repoId: string }
  /** Their chat, at `messageId` when the call posted one; `details`: their window's details on that tab instead. */
  | { kind: 'agent'; agentId: string; messageId?: number; details?: 'now' | 'setup' }
  | { kind: 'section'; section: ActionSection; repoId?: string }
  | { kind: 'approvals' }
  | { kind: 'decision'; id: string }; // its entry in the decision log (#208)

/** How a card's Undo puts back what a call changed (#403): a floor's switches as they were, or an experiment started or stopped again. */
export type ActionUndo =
  | { kind: 'floor'; repoId: string; patch: { autoAssign?: boolean; autoMerge?: boolean; practices?: Record<string, unknown> } }
  | { kind: 'experiment'; id: string; action: 'start' | 'stop' };

export interface ChatAction {
  tool: string; // the office tool, e.g. file_issue
  icon: string;
  text: string; // the result in one line: "Filed floor 3 #104 · Pocket mode for desktop"
  refused?: true; // the office said no: nothing changed
  ref?: ActionRef;
  askedIn?: number; // the manager's message that asked for it (#403)
  undo?: ActionUndo; // what the card's Undo does, while it hasn't been used
  undone?: true;
}

export const MAX_ACTIONS = 8;
const TEXT_MAX = 120;

// The office tools that change something (and wait_for), and their icons; each card opens what it's about (#215).
const ACTS: Record<string, string> = {
  file_issue: '📝',
  close_issue: '🗂️',
  set_dependencies: '🔗',
  scale_team: '👥',
  configure_agent: '⚙️',
  message_agent: '💬',
  answer_agent: '💬',
  assign_issue: '📌',
  restart_agent: '🔄',
  stop_agent: '⏹️',
  ask_manager_choice: '🙋',
  retry_qa: '🔍',
  send_back: '↩️',
  rerun_checks: '🔁',
  close_pull: '✖️',
  escalate: '🚩',
  set_mandate: '📜',
  propose_charter: '🧭',
  propose_design: '🎨',
  resolve_decision: '✅',
  define_experiment: '🧪',
  set_floor_profile: '🏢',
  set_office_playbook: '📘',
  apply_setup: '🧭',
  send_telegram: '✈️',
  scan_keys: '🔑',
  make_default_account: '🔀',
  wait_for: '⏳',
  run_experiment: '🧪',
  set_floor_switches: '🎛️',
  set_issue_priority: '⭐',
  set_ceo_setup: '⚙️',
  apply_charter: '🧭',
  merge_pull: '🔀',
  it_propose: '🖥️',
};

/** The office tools that aren't cards: reads, and what shows in the chat itself (files, edits, reactions, questions). */
export const NOT_CARDS = new Set(['company_status', 'floor_detail', 'agent_detail', 'agent_log', 'qa_report', 'worktree_file', 'pr_diff', 'session_history', 'it_run', 'consult', 'attach_file', 'keep_file', 'edit_message', 'react', 'reply', 'ask_manager']);

// Tools whose card opens a console section (with the floor, when the call names one).
const SECTIONS: Partial<Record<string, ActionSection>> = {
  scale_team: 'team',
  set_floor_profile: 'ceo',
  set_mandate: 'ceo',
  propose_charter: 'charter',
  define_experiment: 'ops',
  run_experiment: 'ops',
  set_floor_switches: 'projects',
  set_ceo_setup: 'ceo',
  apply_charter: 'charter',
  set_office_playbook: 'projects',
  send_telegram: 'notifications',
  scan_keys: 'providers',
  it_propose: 'ops',
  make_default_account: 'accounts',
};
const DETAILS: Partial<Record<string, 'now' | 'setup'>> = { restart_agent: 'now', stop_agent: 'now', configure_agent: 'setup' };

const clip = (s: string) => {
  const t = s.split('\n')[0].replace(/\s+/g, ' ').trim();
  return t.length > TEXT_MAX ? `${t.slice(0, TEXT_MAX - 1).trimEnd()}…` : t;
};
const num = (v: unknown) => (typeof v === 'number' && Number.isInteger(v) && v > 0 ? v : null);

/** What a call's card opens: its decision, its section, its issue or PR (retry_qa: its QA report), else its agent, else its floor. */
function refOf(call: OfficeCall, repoOf: (floor: number) => string | null, agentOf: (ref: string) => string | null): ActionRef | undefined {
  // wait_for: the thing its first condition waited on (the usage meter for usage).
  const wait = call.tool === 'wait_for' && Array.isArray(call.args?.conditions) ? (call.args.conditions[0] as Record<string, unknown> | undefined) : undefined;
  const a = wait ?? call.args ?? {};
  if (call.tool === 'propose_design') return { kind: 'approvals' };
  if (call.tool === 'resolve_decision' && typeof a.id === 'string' && a.id) return { kind: 'decision', id: a.id };
  if (wait?.kind === 'usage') return { kind: 'section', section: 'ops' };
  const floor = num(a.floor) ?? (Array.isArray(a.floors) ? num(a.floors[0]) : null);
  const repoId = floor === null ? null : repoOf(floor);
  const section = SECTIONS[call.tool];
  if (section) return { kind: 'section', section, ...(repoId && { repoId }) };
  const filed = call.tool === 'file_issue' && call.ok ? num(Number(call.out?.match(/#(\d+)/)?.[1])) : null;
  const n = filed ?? num(a.number) ?? num(a.pr) ?? num(a.issue);
  if (repoId && n) return { kind: call.tool === 'retry_qa' ? 'qa' : 'issue', repoId, number: n };
  if (typeof a.agent_id === 'string' && a.agent_id) {
    const details = DETAILS[call.tool];
    return { kind: 'agent', agentId: agentOf(a.agent_id) ?? a.agent_id, ...(call.messageId !== undefined && { messageId: call.messageId }), ...(details && { details }) };
  }
  if (repoId) return { kind: 'floor', repoId };
  return undefined;
}

/** The card's line: a filed issue reads "Filed floor 3 #104 · title", anything else the office's own answer. */
function textOf(call: OfficeCall): string {
  const out = call.out ?? '';
  if (!call.ok) return clip(`Refused: ${out.replace(/^Refused:\s*/, '')}`);
  const filed = call.tool === 'file_issue' ? out.match(/^Filed #(\d+) on floor (\d+): (.*?)\.?$/m) : null;
  return clip(filed ? `Filed floor ${filed[2]} #${filed[1]} · ${filed[3]}` : out);
}

/** The cards for a reply's office calls, in the order they were made; calls still running are left out. `agentOf`: an agent's id from the id or name the CEO gave. */
export function actionCards(calls: readonly OfficeCall[], repoOf: (floor: number) => string | null, agentOf: (ref: string) => string | null = () => null): ChatAction[] {
  const out: ChatAction[] = [];
  for (const call of calls) {
    const icon = ACTS[call.tool];
    if (!icon || call.out === null) continue;
    const ref = refOf(call, repoOf, agentOf);
    const askedIn = typeof call.args?.asked_in === 'number' ? call.args.asked_in : null;
    out.push({ tool: call.tool, icon, text: textOf(call), ...(!call.ok && { refused: true as const }), ...(ref && { ref }), ...(askedIn !== null && call.ok && { askedIn }), ...(call.ok && call.undo && { undo: call.undo }) });
  }
  return out.slice(0, MAX_ACTIONS);
}
