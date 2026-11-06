// What a CEO reply did (#108): the office tools it called that change something, as compact cards under the message
// (an icon, the result in one line, and what a tap opens and the live status follows). Built from the job's recorded
// calls (server/ceoChat.ts), so it costs the CEO nothing. Read-only tools stay in the "Steps" fold. Pure.
import type { OfficeCall } from './ceoStream.ts';

/** What an action card opens, and whose live status it shows. */
export type ActionRef = { kind: 'issue'; repoId: string; number: number } | { kind: 'floor'; repoId: string } | { kind: 'agent'; agentId: string };

export interface ChatAction {
  tool: string; // the office tool, e.g. file_issue
  icon: string;
  text: string; // the result in one line: "Filed floor 3 #104 · Pocket mode for desktop"
  refused?: true; // the office said no: nothing changed
  ref?: ActionRef;
}

export const MAX_ACTIONS = 8;
const TEXT_MAX = 120;

// The office tools that change something, and their icons. Anything else (reads, waits, files) is not a card.
const ACTS: Record<string, string> = {
  file_issue: '📝',
  close_issue: '🗂️',
  set_dependencies: '🔗',
  scale_team: '👥',
  configure_agent: '⚙️',
  message_agent: '💬',
  answer_agent: '💬',
  restart_agent: '🔄',
  retry_qa: '🔍',
  send_back: '↩️',
  rerun_checks: '🔁',
  close_pull: '✖️',
  escalate: '🚩',
  set_mandate: '📜',
  propose_charter: '🧭',
  resolve_decision: '✅',
  define_experiment: '🧪',
  set_floor_profile: '🏢',
  set_office_playbook: '📘',
  send_telegram: '✈️',
};

const clip = (s: string) => {
  const t = s.split('\n')[0].replace(/\s+/g, ' ').trim();
  return t.length > TEXT_MAX ? `${t.slice(0, TEXT_MAX - 1).trimEnd()}…` : t;
};
const num = (v: unknown) => (typeof v === 'number' && Number.isInteger(v) && v > 0 ? v : null);

/** What a call's card opens: its issue or PR, else its agent, else its floor. */
function refOf(call: OfficeCall, repoOf: (floor: number) => string | null): ActionRef | undefined {
  const a = call.args ?? {};
  const floor = num(a.floor);
  const repoId = floor === null ? null : repoOf(floor);
  const filed = call.tool === 'file_issue' && call.ok ? num(Number(call.out?.match(/#(\d+)/)?.[1])) : null;
  const n = filed ?? num(a.number) ?? num(a.pr);
  if (repoId && n) return { kind: 'issue', repoId, number: n };
  if (typeof a.agent_id === 'string' && a.agent_id) return { kind: 'agent', agentId: a.agent_id };
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

/** The cards for a reply's office calls, in the order they were made; calls still running are left out. */
export function actionCards(calls: readonly OfficeCall[], repoOf: (floor: number) => string | null): ChatAction[] {
  const out: ChatAction[] = [];
  for (const call of calls) {
    const icon = ACTS[call.tool];
    if (!icon || call.out === null) continue;
    const ref = refOf(call, repoOf);
    out.push({ tool: call.tool, icon, text: textOf(call), ...(!call.ok && { refused: true as const }), ...(ref && { ref }) });
  }
  return out.slice(0, MAX_ACTIONS);
}
