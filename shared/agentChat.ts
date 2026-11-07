// Agent chat mode (#120): an agent's session as a simple conversation instead of the raw CLI. The office reads the
// session's transcript (server/transcriptTail.ts) into events, folds them into chat items here (their words as
// bubbles, each tool call as a step in plain words, milestones like a pushed branch or an opened PR) and sends the
// items that changed to the tabs with that agent's window open. The window groups runs of steps ("Explored 9 files").
// Pure, for the server, the demo and the client.
import type { AgentStatusReaction, Reaction } from './reactions.ts';

type StepGroup = 'explore' | 'edit' | 'run' | 'browser' | 'plan' | 'helper' | 'other';

/** One item of an agent's chat: a prompt card, their text, a step, the manager's message or a milestone. */
export interface ChatItem {
  id: number; // per agent, increasing; an item sent again (a step's result came back, a reaction) replaces it
  t: number;
  kind: 'prompt' | 'text' | 'step' | 'manager' | 'milestone';
  text: string; // the words; a step's label ("Read App.tsx"); a milestone's title
  group?: StepGroup;
  key?: string; // a step's tool call id
  file?: string; // the file a read or edit was on, relative to their worktree
  plus?: number; // an edit's lines added and removed
  minus?: number;
  detail?: string; // the command, pattern or diff, clipped
  output?: string; // the end of the result, clipped
  outcome?: string; // "312 passed", "built"
  error?: string; // why the step failed
  done?: boolean; // the step's result came back
  milestone?: 'pushed' | 'pr';
  pr?: number;
  url?: string;
  who?: string; // a message's sender ("Manager", "Mimoun (CEO)")
  reactions?: Reaction[]; // the manager's, on this item
}

/** What the transcript says happened, in order. */
export type TranscriptEvent =
  | { kind: 'prompt'; t: number; text: string }
  | { kind: 'text'; t: number; text: string; reactions?: Reaction[] } // reactions: only the demo's made-up ones
  | { kind: 'tool'; t: number; id: string; name: string; input: Record<string, unknown> }
  | { kind: 'result'; t: number; id: string; text: string; error: boolean };

/** Items an agent's window keeps; the server keeps as many. */
const CHAT_KEEP = 200;

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const lines = (s: unknown) => (typeof s === 'string' && s ? s.split('\n').length : 0);
const str = (x: unknown) => (typeof x === 'string' ? x : '');

/** The text of a tool result's content: a string, or text blocks. */
function resultText(c: unknown): string {
  if (typeof c === 'string') return c;
  if (!Array.isArray(c)) return '';
  return c.map((b: { type?: string; text?: unknown }) => (b?.type === 'text' && typeof b.text === 'string' ? b.text : '')).filter(Boolean).join('\n');
}

/**
 * The main thread's events in `chunk` (whole JSONL lines of a Claude Code transcript, or the SDK's messages) written
 * at or after `since`. `seen`: line ids already read, updated. Meta lines and the CLI's own command echoes are left out.
 */
export function transcriptEvents(chunk: string, since: number, seen: Set<string>): TranscriptEvent[] {
  const out: TranscriptEvent[] = [];
  for (const line of chunk.split('\n')) {
    if (!line.trim()) continue;
    let e: { type?: string; isSidechain?: boolean; isMeta?: boolean; uuid?: string; timestamp?: string; message?: { content?: unknown } };
    try {
      e = JSON.parse(line);
    } catch {
      continue;
    }
    if ((e.type !== 'assistant' && e.type !== 'user') || e.isSidechain || e.isMeta) continue;
    if (e.uuid) {
      if (seen.has(e.uuid)) continue;
      seen.add(e.uuid);
    }
    const at = Date.parse(e.timestamp ?? '');
    if (Number.isFinite(at) && at < since) continue;
    const t = Number.isFinite(at) ? at : Date.now();
    const content = e.message?.content;
    if (typeof content === 'string') {
      if (e.type === 'user' && content.trim() && !content.startsWith('<')) out.push({ kind: 'prompt', t, text: content.trim() });
      continue;
    }
    if (!Array.isArray(content)) continue;
    for (const b of content as Record<string, unknown>[]) {
      if (b?.type === 'text' && typeof b.text === 'string' && b.text.trim() && !(e.type === 'user' && b.text.startsWith('<'))) {
        out.push({ kind: e.type === 'user' ? ('prompt' as const) : ('text' as const), t, text: b.text.trim() });
      } else if (b?.type === 'tool_use' && e.type === 'assistant') {
        out.push({ kind: 'tool', t, id: str(b.id), name: str(b.name), input: (b.input as Record<string, unknown>) ?? {} });
      } else if (b?.type === 'tool_result' && e.type === 'user') {
        out.push({ kind: 'result', t, id: str(b.tool_use_id), text: resultText(b.content), error: b.is_error === true });
      }
    }
  }
  return out;
}

/** A path as the window shows it: relative to the worktree, forward slashes. */
function relPath(cwd: string, p: unknown): string {
  const s = str(p).replaceAll('\\', '/');
  const root = cwd.replaceAll('\\', '/').replace(/\/$/, '');
  return root && s.toLowerCase().startsWith(`${root.toLowerCase()}/`) ? s.slice(root.length + 1) : s;
}
const base = (p: string) => p.split('/').pop() || p;

/** A shell command in plain words: "Ran the tests", "Pushed the branch"; else the command itself. */
export function commandLabel(command: string): string {
  const c = command.replace(/^cd\s+("[^"]*"|\S+)\s*(&&|;)\s*/, '').trim();
  const rules: [RegExp, string][] = [
    [/\bgh pr create\b/, 'Opened a pull request'],
    [/\bgit push\b/, 'Pushed the branch'],
    [/\bgit commit\b/, 'Committed'],
    [/\b(vitest|jest|pytest|npm (run )?test|npm t\b|yarn test|pnpm test|go test|cargo test)/, 'Ran the tests'],
    [/\b(tsc|typecheck)\b/, 'Checked the types'],
    [/\b(npm|yarn|pnpm) run lint\b|\beslint\b|\boxlint\b/, 'Ran lint'],
    [/\b(npm|yarn|pnpm) run build\b|\bvite build\b/, 'Built the project'],
    [/\b(npm (ci|install|i)\b|yarn install|pnpm install)/, 'Installed dependencies'],
    [/\bgit (diff|log|status|show)\b/, 'Looked at the changes'],
  ];
  const hit = rules.find(([re]) => re.test(c));
  return hit ? hit[1] : `Ran ${clip(c.split('\n')[0], 60)}`;
}

/** A tool call as a step: its group and label in plain words, and what it touched. */
export function stepOf(name: string, input: Record<string, unknown>, cwd: string): Pick<ChatItem, 'group' | 'text' | 'file' | 'plus' | 'minus' | 'detail'> {
  const file = relPath(cwd, input.file_path ?? input.notebook_path ?? input.path);
  switch (name) {
    case 'Read':
      return { group: 'explore', text: `Read ${base(file)}`, file };
    case 'Grep':
      return { group: 'explore', text: `Searched for "${clip(str(input.pattern), 40)}"`, detail: str(input.pattern) };
    case 'Glob':
    case 'LS':
      return { group: 'explore', text: `Listed ${clip(str(input.pattern) || file || 'files', 40)}` };
    case 'WebFetch':
    case 'WebSearch':
      return { group: 'explore', text: `Looked up ${clip(str(input.query) || str(input.url), 50)}` };
    case 'Edit':
    case 'MultiEdit':
    case 'NotebookEdit': {
      const edits = Array.isArray(input.edits) ? (input.edits as Record<string, unknown>[]) : [input];
      const plus = edits.reduce((n, e) => n + lines(e.new_string ?? e.new_source), 0);
      const minus = edits.reduce((n, e) => n + lines(e.old_string), 0);
      const diff = edits.map((e) => `${str(e.old_string).split('\n').map((l) => `- ${l}`).join('\n')}\n${str(e.new_string ?? e.new_source).split('\n').map((l) => `+ ${l}`).join('\n')}`).join('\n');
      return { group: 'edit', text: `Edited ${base(file)} (+${plus} −${minus})`, file, plus, minus, detail: clip(diff, 1500) };
    }
    case 'Write': {
      const plus = lines(input.content);
      return { group: 'edit', text: `Wrote ${base(file)} (+${plus})`, file, plus, minus: 0 };
    }
    case 'Bash':
    case 'PowerShell': {
      const command = cwd ? str(input.command).replaceAll(`${cwd}/`, '').replaceAll(cwd, '.') : str(input.command);
      return { group: 'run', text: commandLabel(command), detail: clip(command, 600) };
    }
    case 'TodoWrite': {
      const todos = Array.isArray(input.todos) ? (input.todos as { content?: string; status?: string }[]) : [];
      return { group: 'plan', text: 'Updated the plan', detail: todos.map((x) => `${x.status === 'completed' ? '✓' : x.status === 'in_progress' ? '◐' : '○'} ${x.content ?? ''}`).join('\n') };
    }
    case 'Task':
    case 'Agent':
      return { group: 'helper', text: `Asked a helper: ${clip(str(input.description), 50)}` };
  }
  const browser = name.match(/^mcp__playwright__browser_(\w+)/);
  if (browser) {
    const act = browser[1].replace(/_/g, ' ');
    const label = browser[1] === 'navigate' ? `Opened ${clip(str(input.url).replace(/^https?:\/\//, ''), 40)}` : browser[1] === 'take_screenshot' ? 'Took a screenshot' : `${act[0].toUpperCase()}${act.slice(1)}${input.element ? ` ${clip(str(input.element), 30)}` : ''}`;
    return { group: 'browser', text: label };
  }
  return { group: 'other', text: `Used ${name.replace(/^mcp__\w+?__/, '').replace(/_/g, ' ')}` };
}

/** A run's result in a few words: "312 passed", "3 failed · 309 passed", "built". */
export function outcomeOf(text: string): string | undefined {
  const tests = text.match(/Tests?\s+(?:(\d+) failed[^\d\n]*)?(\d+) passed/i);
  if (tests) return tests[1] ? `${tests[1]} failed · ${tests[2]} passed` : `${tests[2]} passed`;
  const failed = text.match(/(\d+) failed/i);
  if (failed) return `${failed[1]} failed`;
  const passed = text.match(/(\d+) passed/i);
  if (passed) return `${passed[1]} passed`;
  if (/\bbuilt in\b/i.test(text)) return 'built';
  return undefined;
}

/** The end of a result, as the expanded step shows it. */
const tail = (text: string) => clip(text.split('\n').slice(-12).join('\n'), 1500);

/**
 * An agent's chat: the items it keeps and the next id. `apply` folds transcript events in and returns the items that
 * are new or changed, every text passed through `mask` (secrets) first.
 */
export class ChatLog {
  items: ChatItem[] = [];
  private seq = 1;
  private prompted = false;

  /** A new session: its first prompt is the task card again. */
  session() {
    this.prompted = false;
  }

  add(item: Omit<ChatItem, 'id'>): ChatItem {
    const it = { ...item, id: this.seq++ } as ChatItem;
    this.items.push(it);
    if (this.items.length > CHAT_KEEP) this.items.splice(0, this.items.length - CHAT_KEEP);
    return it;
  }

  apply(events: readonly TranscriptEvent[], cwd: string, mask: (t: string) => string = (t) => t): ChatItem[] {
    const changed = new Map<number, ChatItem>();
    const put = (it: ChatItem) => changed.set(it.id, it);
    for (const ev of events) {
      if (ev.kind === 'prompt') {
        // Only the task's prompt: the manager's messages and reactions are already in (Swarm.message).
        if (this.prompted || ev.text.startsWith('[manager reacted')) continue;
        this.prompted = true;
        const said = this.items.some((x) => x.kind === 'manager' && x.text.slice(0, 60) === ev.text.slice(0, 60));
        if (!said) put(this.add({ t: ev.t, kind: 'prompt', text: clip(mask(ev.text), 4000) }));
      } else if (ev.kind === 'text') {
        this.prompted = true;
        put(this.add({ t: ev.t, kind: 'text', text: clip(mask(ev.text), 8000), ...(ev.reactions && { reactions: ev.reactions }) }));
      } else if (ev.kind === 'tool') {
        this.prompted = true;
        const s = stepOf(ev.name, ev.input, cwd);
        put(this.add({ t: ev.t, kind: 'step', key: ev.id, ...s, text: mask(s.text), ...(s.detail && { detail: mask(s.detail) }) }));
      } else {
        const step = this.items.find((x) => x.kind === 'step' && x.key === ev.id);
        if (!step || step.done) continue;
        const text = mask(ev.text);
        step.done = true;
        if (text.trim()) step.output = tail(text);
        if (ev.error) step.error = clip(text.split('\n').find((l) => l.trim()) ?? 'Failed', 200);
        else if (step.group === 'run') step.outcome = outcomeOf(text);
        put(step);
        const m = ev.error ? null : milestoneOf(step, text);
        if (m) put(this.add({ t: ev.t, kind: 'milestone', ...m }));
      }
    }
    return [...changed.values()];
  }

  /** Toggles the manager's reaction on an item; the changed item, or null when there's none with that id. */
  react(id: number, r: Reaction): { item: ChatItem; added: boolean } | null {
    const it = this.items.find((x) => x.id === id);
    if (!it) return null;
    const had = it.reactions?.includes(r) ?? false;
    const next = had ? it.reactions!.filter((x) => x !== r) : [...(it.reactions ?? []), r];
    if (next.length) it.reactions = next;
    else delete it.reactions;
    return { item: it, added: !had };
  }
}

/** A step that reached a milestone: the branch pushed, the PR opened. */
function milestoneOf(step: ChatItem, result: string): Pick<ChatItem, 'text' | 'milestone' | 'pr' | 'url'> | null {
  if (step.text === 'Opened a pull request') {
    const url = result.match(/https?:\/\/\S+\/pull\/(\d+)/);
    return url ? { text: `Opened PR #${url[1]}`, milestone: 'pr', pr: Number(url[1]), url: url[0] } : null;
  }
  if (step.text === 'Pushed the branch') return { text: 'Pushed the branch', milestone: 'pushed' };
  return null;
}

/** What the window draws: an item, or a run of steps of one kind shown as one expandable row. */
export type ChatRow = { kind: 'item'; item: ChatItem } | { kind: 'steps'; id: number; label: string; steps: ChatItem[]; running: boolean; failed: boolean };

/** Steps of these kinds next to each other become one row; a command always has its own. */
const GROUPED: StepGroup[] = ['explore', 'edit', 'browser', 'plan'];

/** A run of steps' label: "Explored 9 files", "Edited 3 files (+40 −5)", "Used the browser · 4 steps". */
export function groupLabel(steps: readonly ChatItem[]): string {
  const first = steps[0];
  if (steps.length === 1) return first.outcome ? `${first.text} · ${first.outcome}` : first.text;
  const files = new Set(steps.map((s) => s.file).filter(Boolean));
  switch (first.group) {
    case 'explore': {
      const reads = steps.filter((s) => s.text.startsWith('Read ')).length;
      const searches = steps.length - reads;
      const read = reads ? `${new Set(steps.filter((s) => s.text.startsWith('Read ')).map((s) => s.file)).size} file${reads > 1 ? 's' : ''}` : '';
      return `Explored ${[read, searches ? `${searches} search${searches > 1 ? 'es' : ''}` : ''].filter(Boolean).join(' and ')}`;
    }
    case 'edit': {
      const plus = steps.reduce((n, s) => n + (s.plus ?? 0), 0);
      const minus = steps.reduce((n, s) => n + (s.minus ?? 0), 0);
      const what = files.size === 1 ? base([...files][0]!) : `${files.size} files`;
      return `Edited ${what} (+${plus} −${minus})`;
    }
    case 'browser':
      return `Used the browser · ${steps.length} steps`;
    case 'plan':
      return 'Updated the plan';
    default:
      return `${steps.length} steps`;
  }
}

/** The items as rows: runs of grouped steps of one kind merged. */
export function chatRows(items: readonly ChatItem[]): ChatRow[] {
  const rows: ChatRow[] = [];
  for (const it of items) {
    const last = rows[rows.length - 1];
    if (it.kind === 'step' && last?.kind === 'steps' && GROUPED.includes(it.group!) && last.steps[0].group === it.group) last.steps.push(it);
    else if (it.kind === 'step') rows.push({ kind: 'steps', id: it.id, label: '', steps: [it], running: false, failed: false });
    else rows.push({ kind: 'item', item: it });
  }
  for (const r of rows) {
    if (r.kind !== 'steps') continue;
    r.label = groupLabel(r.steps);
    r.running = r.steps.some((s) => !s.done);
    r.failed = r.steps.some((s) => !!s.error);
  }
  return rows;
}

/** Folds items the office sent into what a tab has: same id replaces, new ones appended in order, the newest kept. */
export function mergeChat(prev: readonly ChatItem[], fresh: readonly ChatItem[]): ChatItem[] {
  const byId = new Map(prev.map((x) => [x.id, x]));
  for (const x of fresh) byId.set(x.id, x);
  const all = [...byId.values()].sort((a, b) => a.id - b.id);
  return all.length > CHAT_KEEP ? all.slice(-CHAT_KEEP) : all;
}

/**
 * The office's own reaction on the manager's message at `index`: 👀 once it's in, ⏳ while they work on it, ✅ once
 * they've answered (a reply after it, and their turn is over or ended on that reply).
 */
export function statusReaction(items: readonly ChatItem[], index: number, working: boolean): AgentStatusReaction {
  const after = items.slice(index + 1).filter((x) => x.kind !== 'manager');
  if (!after.length) return '👀';
  const replied = after.some((x) => x.kind === 'text');
  return replied && (!working || after[after.length - 1].kind === 'text') ? '✅' : '⏳';
}

/** What an item is quoted as in a reaction's note: its words, or its step's label. */
export const quoteOf = (it: ChatItem) => it.text;
