// A Markdown code block's pure parts (#200): its language's label, shell lines with a prompt, what Copy copies.

const LABELS: Record<string, string> = {
  bash: 'Terminal', sh: 'Terminal', shell: 'Terminal', zsh: 'Terminal', console: 'Terminal', powershell: 'PowerShell', ps1: 'PowerShell',
  ts: 'TypeScript', tsx: 'TypeScript', typescript: 'TypeScript', js: 'JavaScript', jsx: 'JavaScript', javascript: 'JavaScript', mjs: 'JavaScript',
  json: 'JSON', yaml: 'YAML', yml: 'YAML', md: 'Markdown', markdown: 'Markdown', html: 'HTML', css: 'CSS', diff: 'Diff', sql: 'SQL', py: 'Python', python: 'Python',
};
const SHELLS = new Set(['bash', 'sh', 'shell', 'zsh', 'console']);

/** The fence's language from the code element's classes (`language-bash`), lower case; '' when there's none. */
export function codeLanguage(className: unknown): string {
  const classes = Array.isArray(className) ? className.join(' ') : typeof className === 'string' ? className : '';
  return classes.match(/(?:^|\s)language-([\w+#-]+)/)?.[1].toLowerCase() ?? '';
}

/** The header's label: Terminal for shells, the language's name, else the fence as written, or Code. */
export function languageLabel(lang: string): string {
  return LABELS[lang] ?? (lang ? lang.toUpperCase() : 'Code');
}

export const isShell = (lang: string) => SHELLS.has(lang);

export interface CodeLine {
  text: string;
  /** Starts a command: shown after a `$` prompt that is never copied. */
  prompt: boolean;
}

/**
 * A shell block's lines. If some start with `$ ` (a console transcript), those are the commands and the rest output;
 * otherwise every line starts a command except blanks, comments and continuations of a line ending in `\`.
 */
export function shellLines(code: string): CodeLine[] {
  const lines = code.split('\n');
  if (lines.some((l) => l.startsWith('$ '))) return lines.map((l) => (l.startsWith('$ ') ? { text: l.slice(2), prompt: true } : { text: l, prompt: false }));
  return lines.map((text, i) => ({ text, prompt: !!text.trim() && !text.trimStart().startsWith('#') && !lines[i - 1]?.endsWith('\\') }));
}

/** What Copy puts on the clipboard: the code alone, line breaks kept, no prompt and no trailing newline. */
export function copiedText(code: string, lang: string): string {
  if (!isShell(lang)) return code.replace(/\n+$/, '');
  const lines = shellLines(code.replace(/\n+$/, ''));
  // a console transcript's output isn't something to run
  const commands = code.split('\n').some((l) => l.startsWith('$ ')) ? lines.filter((l) => l.prompt) : lines;
  return commands.map((l) => l.text).join('\n');
}

/** Blocks longer than this start collapsed behind "Show all N lines". */
export const COLLAPSE_LINES = 12;
