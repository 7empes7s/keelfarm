// The CEO's consults (#28), pure: a question for an agent on a floor, answered in a short read-only session. Which
// queued consult a free agent takes, the cap on how many run at once, what the session may not do, and its prompt.

export interface Consult {
  id: string;
  repoId: string;
  floor: number;
  agentId: string | null; // a named agent, or null for any free one on the floor
  question: string;
  hint: string | null; // "as a security reviewer", "use the architecture skill"
  at: number;
  runningOn: string | null; // the agent answering it, once started
}

/** An answer is cut to this many characters: the CEO pays for every one. */
export const CONSULT_ANSWER_MAX = 6000;

/**
 * The consult a free agent on `repoId` takes next, or null: the oldest queued one there for them by name, or for any
 * free agent, while fewer than `cap` run. The scheduler asks only after QA and fixes had their pick of free agents.
 */
export function nextConsult(queue: readonly Consult[], repoId: string, free: readonly string[], cap: number): { consult: Consult; agentId: string } | null {
  if (queue.filter((c) => c.runningOn).length >= cap) return null;
  for (const c of [...queue].sort((x, y) => x.at - y.at)) {
    if (c.runningOn || c.repoId !== repoId) continue;
    const agentId = c.agentId ? (free.includes(c.agentId) ? c.agentId : null) : (free[0] ?? null);
    if (agentId) return { consult: c, agentId };
  }
  return null;
}

/** Built-in tools a consult session doesn't get (--disallowedTools), on top of the office's. */
export const CONSULT_DISALLOWED = ['Edit', 'Write', 'MultiEdit', 'NotebookEdit', 'Bash(git push:*)', 'Bash(git commit:*)', 'Bash(gh pr:*)'];

// An allowlist: tools that only read, and shell commands that only read, with nothing chained, piped or redirected.
const READ_TOOLS = new Set(['Read', 'Glob', 'Grep', 'LS', 'TodoWrite', 'Skill', 'ToolSearch']);
const READ_COMMANDS = /^(git\s+(log|show|diff|status|blame|grep|ls-files|rev-parse|branch\s+--list)|ls|cat|head|tail|wc|grep|rg|tree|pwd)(\s|$)/;
const SHELL_TRICKS = /[;&|<>`$(){}\n\\]/;

/** Why a consult session's tool call is refused (the pre-tool check behind CONSULT_DISALLOWED), or null to allow it. */
export function consultRefusal(tool: string, input: Record<string, unknown>): string | null {
  if (READ_TOOLS.has(tool)) return null;
  if (tool !== 'Bash' && tool !== 'PowerShell') return `This is a read-only consult: ${tool} isn't available. Read the code with Read, Glob and Grep.`;
  const cmd = String(input.command ?? '').trim();
  if (READ_COMMANDS.test(cmd) && !SHELL_TRICKS.test(cmd)) return null;
  return 'This is a read-only consult: only simple read commands (git log/show/diff/blame, ls, cat, grep, rg) run, with no pipes, chaining or redirects. No edits, commits, pushes or pull requests.';
}

/** The consult session's prompt: the CEO's question, any role or skill hint, and the rules. Kept short: it's paid for. */
export function consultPrompt(c: Pick<Consult, 'question' | 'hint' | 'floor'>, fullName: string, ceo: string): string {
  return [
    `${ceo}, the CEO, asks you a question about floor ${c.floor} (${fullName})${c.hint ? `, ${c.hint}` : ''}:`,
    `"""${c.question}"""`,
    '',
    'Read the code to answer. This is a read-only consult: no edits, commits, pushes or pull requests.',
    'Answer in under 300 words, with file:line references (e.g. src/app.ts:120) for every claim.',
  ].join('\n');
}

/** What consult returns to the CEO: who answered and what they said, cut to CONSULT_ANSWER_MAX. */
export function consultAnswer(name: string, floor: number, text: string): string {
  const t = text.trim() || '(no answer)';
  return `${name} on floor ${floor} says:\n${t.length > CONSULT_ANSWER_MAX ? `${t.slice(0, CONSULT_ANSWER_MAX - 1)}…` : t}`;
}
