// "What I used" under a CEO reply: the skills, connectors (MCP servers) and built-in tools the CEO called for it,
// grouped from the session's tool calls. Names and counts only.

/** What the CEO used for one reply. */
export interface UsedView {
  skills: string[];
  connectors: { name: string; tools: number }[]; // MCP servers, by calls
  tools: { name: string; count: number }[]; // built-in tools, by calls
}

/** The chat's "/" picks: installed skills and connected apps, by name. */
export interface QuickPicks {
  skills: string[];
  apps: string[];
}

/** What a pick puts in the message box. */
export const pickText = (kind: 'skill' | 'app', name: string) => (kind === 'skill' ? `Use the ${name} skill: ` : `Using ${name}: `);

/** The picks matching what follows "/" (case-insensitive, by any part of the name), skills first, at most `max`. */
export function matchPicks(p: QuickPicks, query: string, max = 8): { kind: 'skill' | 'app'; name: string }[] {
  const q = query.trim().toLowerCase();
  const hit = (n: string) => !q || n.toLowerCase().includes(q);
  return [...p.skills.filter(hit).map((name) => ({ kind: 'skill' as const, name })), ...p.apps.filter(hit).map((name) => ({ kind: 'app' as const, name }))].slice(0, max);
}

/** One tool call as the office saw it: its tool name, and the skill's name for a Skill call. */
export interface ToolCall {
  name: string;
  skill?: string;
}

/** The tool calls among a session's log entries (a Skill call's line reads "Skill <name>"). */
export function toolCalls(entries: readonly { kind: string; tool?: string; text: string }[]): ToolCall[] {
  return entries
    .filter((e) => e.kind === 'tool' && e.tool)
    .map((e) => (e.tool === 'Skill' ? { name: 'Skill', skill: /Skill (\S+)/.exec(e.text)?.[1] } : { name: e.tool! }));
}

/** An MCP server's name for people: claude.ai's connectors and plugins' servers without their prefixes. */
export function connectorName(server: string): string {
  if (server === 'office') return 'Office';
  const s = server.replace(/^claude_ai_/, '').replace(/^plugin_([^_]+)_\1$/, '$1').replace(/^plugin_[^_]+_/, '');
  const words = s.replace(/[_-]+/g, ' ').trim();
  return words ? words[0].toUpperCase() + words.slice(1) : server;
}

/** Groups a reply's tool calls; null when it used none. */
export function groupUsed(calls: readonly ToolCall[]): UsedView | null {
  if (!calls.length) return null;
  const skills = new Set<string>();
  const connectors = new Map<string, number>();
  const tools = new Map<string, number>();
  for (const c of calls) {
    const mcp = /^mcp__(.+?)__/.exec(c.name);
    if (c.name === 'Skill') skills.add(c.skill || 'a skill');
    else if (mcp) connectors.set(connectorName(mcp[1]), (connectors.get(connectorName(mcp[1])) ?? 0) + 1);
    else tools.set(c.name, (tools.get(c.name) ?? 0) + 1);
  }
  const byCount = <T extends { name: string }>(a: T & { n: number }, b: T & { n: number }) => b.n - a.n || a.name.localeCompare(b.name);
  return {
    skills: [...skills].sort(),
    connectors: [...connectors].map(([name, n]) => ({ name, n })).sort(byCount).map(({ name, n }) => ({ name, tools: n })),
    tools: [...tools].map(([name, n]) => ({ name, n })).sort(byCount).map(({ name, n }) => ({ name, count: n })),
  };
}

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;

/** The collapsed line: "Used: 2 skills · Gmail · 5 tools" (at most two connectors named, then "+N"). */
export function usedLine(u: UsedView): string {
  const parts: string[] = [];
  if (u.skills.length) parts.push(plural(u.skills.length, 'skill'));
  const names = u.connectors.map((c) => c.name);
  if (names.length) parts.push(names.length > 2 ? `${names.slice(0, 2).join(' · ')} +${names.length - 2}` : names.join(' · '));
  const calls = u.tools.reduce((n, t) => n + t.count, 0);
  if (calls) parts.push(plural(calls, 'tool'));
  return `Used: ${parts.join(' · ')}`;
}
