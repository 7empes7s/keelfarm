// Tools, plugins and skills (Settings → Tools & skills): what a Claude Code session on this machine loads, the
// manager's switches for it (Everyone, the CEO, each agent), and how a session's switches become its command line.
// Pure: the server scans the inventory (server/tooling.ts) and both sides read it through these rules.

export type ToolKind = 'plugin' | 'skill' | 'mcp' | 'builtin';
export type ToolRole = 'agent' | 'ceo';

/** Why an item can't be switched for a role, and how it stays. */
export interface ToolLock {
  on: boolean;
  why: string;
}

export interface ToolItem {
  /** 'plugin:<name>@<marketplace>', 'skill:<name>', 'mcp:<tool-name prefix>' or 'tool:<Name>'. */
  id: string;
  kind: ToolKind;
  name: string;
  description: string; // one line
  source: string; // where it comes from, e.g. "user", "project", "plugin canva", "office", "Claude Code"
  /** Rough per-session context cost: tools or entries it adds, and tokens of their descriptions when known. */
  cost: { tools?: number; tokens?: number } | null;
  /** Roles it can't be switched for (absent: switchable for everyone). */
  locks?: Partial<Record<ToolRole, ToolLock>>;
  /** The plugin that brings it (a plugin's MCP server). */
  plugin?: string;
  /** A plugin's contents. */
  contents?: { skills: string[]; commands: string[]; agents: string[]; mcp: string[] };
  /** How it runs, masked: never an env value, header value or query string. */
  detail?: string;
}

export interface ToolInventory {
  items: ToolItem[];
  scannedAt: number | null; // null: not scanned yet
  scanning: boolean;
  error: string | null;
  /** Where it was read from, e.g. "claude plugin list + config files". */
  via: string;
}

/** Item id → on (true) or off (false). Missing: follow the scope above (Everyone), else on. */
export type ToolSwitches = Record<string, boolean>;

export interface ToolSettings {
  everyone: ToolSwitches;
  ceo: ToolSwitches;
}

export const DEFAULT_TOOL_SETTINGS: ToolSettings = { everyone: {}, ceo: {} };
export const EMPTY_INVENTORY: ToolInventory = { items: [], scannedAt: null, scanning: false, error: null, via: '' };

const ID = /^(plugin|skill|mcp|tool):[^\s]{1,200}$/;
export const isToolId = (v: unknown): v is string => typeof v === 'string' && ID.test(v);

/** Saved or sent switches, with anything that isn't an item id → boolean dropped. */
export function cleanSwitches(raw: unknown): ToolSwitches {
  const out: ToolSwitches = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>).slice(0, 500)) if (isToolId(k) && typeof v === 'boolean') out[k] = v;
  return out;
}

export function toolSettings(base: ToolSettings, raw: unknown): ToolSettings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<Record<keyof ToolSettings, unknown>>;
  return { everyone: r.everyone === undefined ? base.everyone : cleanSwitches(r.everyone), ceo: r.ceo === undefined ? base.ceo : cleanSwitches(r.ceo) };
}

/** One switch changed: on/off, or null to follow the scope above. */
export function setSwitch(switches: ToolSwitches, id: string, on: boolean | null): ToolSwitches {
  const next = { ...switches };
  if (on === null) delete next[id];
  else next[id] = on;
  return next;
}

// ---------- the office's own ----------

/** MCP servers the office adds to its sessions: never switched off where it needs them. */
export const OFFICE_SERVERS = ['office', 'playwright'];

/** Claude Code tools whose result arrives in a later turn, while an office session ends with its turn. */
export const CROSS_TURN_TOOLS = ['Monitor', 'ScheduleWakeup', 'CronCreate', 'CronDelete', 'CronList', 'RemoteTrigger'];

/** Always off in office sessions, whatever the switches say. */
export const OFFICE_DISALLOWED = ['AskUserQuestion', 'EnterPlanMode', 'ExitPlanMode', ...CROSS_TURN_TOOLS];
/** Off for the CEO, who reads and acts through the office tools and never runs commands. */
export const CEO_DISALLOWED = ['Bash', 'PowerShell', 'NotebookEdit'];

const ASKS = "Office sessions can't stop to ask: the office answers for the manager";
const LATER = 'Its result comes in a later turn, and an office session ends with its turn';
const CEO_NO_RUN = 'The CEO acts through the office tools and never runs commands';

function builtin(name: string, description: string, locks?: ToolItem['locks']): ToolItem {
  return { id: `tool:${name}`, kind: 'builtin', name, description, source: 'Claude Code', cost: { tools: 1 }, ...(locks ? { locks } : {}) };
}

/** The office's MCP servers and the built-in tools it disables or lets the manager switch. */
export function officeItems(): ToolItem[] {
  const off = (why: string): ToolItem['locks'] => ({ agent: { on: false, why }, ceo: { on: false, why } });
  return [
    {
      id: 'mcp:office',
      kind: 'mcp',
      name: 'office',
      description: "The CEO's office tools: floors, issues, team changes, triage.",
      source: 'office',
      cost: null,
      locks: { ceo: { on: true, why: 'The CEO runs the company through it' }, agent: { on: false, why: 'Only the CEO gets the office tools' } },
    },
    {
      id: 'mcp:playwright',
      kind: 'mcp',
      name: 'playwright',
      description: 'A browser for floors that test in one (QA and builds check the app with it).',
      source: 'office',
      cost: null,
      locks: { agent: { on: true, why: "The office adds it on floors that test in a browser: QA needs it" }, ceo: { on: false, why: 'The CEO never tests in a browser' } },
    },
    builtin('Bash', 'Runs shell commands.', { agent: { on: true, why: 'Agents build, test and push with it' }, ceo: { on: false, why: CEO_NO_RUN } }),
    builtin('PowerShell', 'Runs PowerShell commands (Windows).', { agent: { on: true, why: 'Agents build, test and push with it' }, ceo: { on: false, why: CEO_NO_RUN } }),
    builtin('NotebookEdit', 'Edits Jupyter notebooks.', { ceo: { on: false, why: CEO_NO_RUN } }),
    builtin('WebFetch', 'Fetches a web page and reads it.'),
    builtin('WebSearch', 'Searches the web.'),
    builtin('Agent', 'Starts subagents for side tasks.'),
    builtin('AskUserQuestion', 'Asks the user a multiple-choice question.', off(ASKS)),
    builtin('EnterPlanMode', 'Switches to plan mode.', off(ASKS)),
    builtin('ExitPlanMode', 'Leaves plan mode with a plan to approve.', off(ASKS)),
    ...CROSS_TURN_TOOLS.map((t) => builtin(t, 'Schedules or waits for something later.', off(LATER))),
  ];
}

// ---------- scopes ----------

/** The switches a session follows: Everyone's, then the CEO's or the agent's own on top. */
export function mergeSwitches(everyone: ToolSwitches, override: ToolSwitches | undefined): ToolSwitches {
  return { ...everyone, ...(override ?? {}) };
}

export interface ToolState {
  on: boolean;
  /** locked: can't be switched for this role · own: this scope's switch · everyone: Everyone's · default: nobody switched it. */
  from: 'locked' | 'own' | 'everyone' | 'default';
  lock?: ToolLock;
}

/** Whether an item is on for a role, and why. `own` is the CEO's or agent's switches (absent for the Everyone scope). */
export function itemState(item: ToolItem, role: ToolRole, everyone: ToolSwitches, own?: ToolSwitches): ToolState {
  const lock = item.locks?.[role];
  if (lock) return { on: lock.on, from: 'locked', lock };
  if (own && item.id in own) return { on: own[item.id], from: 'own' };
  if (item.id in everyone) return { on: everyone[item.id], from: 'everyone' };
  return { on: true, from: 'default' };
}

// ---------- a session's command line ----------

/** What a Claude Code session gets from its switches. */
export interface SessionTools {
  /** Extra --disallowedTools patterns: `mcp__<server>__*`, `Skill(<name>)`, built-in tool names. */
  disallowed: string[];
  /** Plugins turned off for the session (`enabledPlugins: { id: false }` in its --settings file). */
  disabledPlugins: string[];
}

export const NO_SESSION_TOOLS: SessionTools = { disallowed: [], disabledPlugins: [] };

/** The disallowed-tools pattern for every tool of an MCP server, by the prefix its tools are named with. */
export const mcpPattern = (key: string) => `mcp__${key}__*`;

/**
 * A session's extra disallowed tools and disabled plugins from its merged switches. Works from the switches' ids, so
 * it holds even before the inventory is scanned; the inventory adds the locks and which plugin brings a server.
 * Never touches the office's own servers or the tools it already disables.
 */
export function sessionTools(items: ToolItem[], role: ToolRole, switches: ToolSwitches): SessionTools {
  const byId = new Map([...officeItems(), ...items].map((i) => [i.id, i]));
  const off = (id: string) => {
    const item = byId.get(id);
    if (item?.locks?.[role]) return !item.locks[role]!.on;
    return switches[id] === false;
  };
  const base = new Set([...OFFICE_DISALLOWED, ...(role === 'ceo' ? CEO_DISALLOWED : [])]);
  const disallowed: string[] = [];
  const disabledPlugins: string[] = [];
  for (const [id, on] of Object.entries(switches)) {
    if (on || !isToolId(id)) continue;
    const item = byId.get(id);
    if (item?.locks?.[role]) continue; // the office decides: an office server stays, a disabled tool is off already
    const [kind, ...rest] = id.split(':');
    const key = rest.join(':');
    if (kind === 'plugin') disabledPlugins.push(key);
    else if (kind === 'mcp') {
      if (OFFICE_SERVERS.includes(key)) continue;
      if (item?.plugin && off(item.plugin)) continue; // off with its plugin
      disallowed.push(mcpPattern(key));
    } else if (kind === 'skill') disallowed.push(`Skill(${key})`);
    else if (kind === 'tool' && /^[A-Za-z][A-Za-z0-9_]*$/.test(key) && !base.has(key)) disallowed.push(key);
  }
  return { disallowed: [...new Set(disallowed)].sort(), disabledPlugins: [...new Set(disabledPlugins)].sort() };
}

/** The tools part of a Claude Code command line, as the demo logs it: what `sessionTools` adds. */
export function toolArgsLine(t: SessionTools): string {
  const parts: string[] = [];
  if (t.disabledPlugins.length) parts.push(`--settings {"enabledPlugins":{${t.disabledPlugins.map((p) => `"${p}":false`).join(',')}}}`);
  if (t.disallowed.length) parts.push(`--disallowedTools … ${t.disallowed.join(' ')}`);
  return parts.join(' ');
}

// ---------- the screen ----------

export const TOOL_GROUPS: { kind: ToolKind; label: string }[] = [
  { kind: 'plugin', label: 'Plugins' },
  { kind: 'skill', label: 'Skills' },
  { kind: 'mcp', label: 'MCP servers / connectors' },
  { kind: 'builtin', label: 'Built-in tools' },
];

/** Items matching a search (name, description, source, a plugin's contents), grouped in the screen's order. */
export function groupItems(items: ToolItem[], query: string): { kind: ToolKind; label: string; items: ToolItem[] }[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const text = (i: ToolItem) =>
    [i.name, i.description, i.source, i.detail ?? '', ...(i.contents ? [...i.contents.skills, ...i.contents.commands, ...i.contents.agents, ...i.contents.mcp] : [])].join(' ').toLowerCase();
  const hits = items.filter((i) => words.every((w) => text(i).includes(w)));
  return TOOL_GROUPS.map((g) => ({ ...g, items: hits.filter((i) => i.kind === g.kind).sort((a, b) => a.name.localeCompare(b.name)) })).filter((g) => g.items.length > 0);
}

/** "12 tools", "3 skills · ≈450 tokens"; '' when nothing is known. */
export function costLabel(item: ToolItem): string {
  const c = item.cost;
  if (!c) return '';
  const [one, many] = item.kind === 'plugin' ? ['entry', 'entries'] : item.kind === 'skill' ? ['skill', 'skills'] : ['tool', 'tools'];
  const parts = [c.tools !== undefined ? `${c.tools} ${c.tools === 1 ? one : many}` : '', c.tokens ? `≈${c.tokens} tokens` : ''];
  return parts.filter(Boolean).join(' · ');
}
