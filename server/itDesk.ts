// The IT desk's rules (#506, shared/itDesk.ts): one command, parsed into argv and run with execFile (never a shell).
// it_run takes only read-only programs from an allowlist, reshaped where needed (du stays on one disk at low priority
// under a timeout); it_propose takes any program but what the never-list refuses, which is checked again at Run.
// Pure: the swarm (server/swarm/itDesk.ts) runs what these return.
import path from 'node:path';

/** How long a read may take, and a change the manager ran. */
const READ_TIMEOUT_MS = 2 * 60_000;
export const CHANGE_TIMEOUT_MS = 10 * 60_000;
/** Output kept for the CEO and the chat. */
const OUT_MAX = 20_000;
/** Output kept in the log. */
export const LOG_OUT_MAX = 1_500;

export type Refusal = { refused: string };
export type ReadPlan = { argv: string[]; timeoutMs: number };

const PROPOSE = 'To change the machine, propose it with it_propose: the manager runs it with one tap.';
const SHELL = /[|;&<>`$\n\r]/;

/** One command line as argv: words, '…' or "…" quoted, no shell at all (no pipes, redirects, ;, & or $()). */
export function parseCommand(line: string): { argv: string[] } | Refusal {
  const argv: string[] = [];
  let word: string | null = null;
  let quote: string | null = null;
  for (const ch of line.trim()) {
    if (quote) {
      if (ch === quote) quote = null;
      else word = (word ?? '') + ch;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      word ??= '';
    } else if (SHELL.test(ch)) {
      return { refused: `One command, no shell: "${ch === '\n' ? 'a new line' : ch}" isn't allowed (no pipes, redirects, ;, &, $() or backticks). Sort and limit the output with it_run's sort and lines instead.` };
    } else if (/\s/.test(ch)) {
      if (word !== null) argv.push(word);
      word = null;
    } else word = (word ?? '') + ch;
  }
  if (quote) return { refused: 'A quote is left open.' };
  if (word !== null) argv.push(word);
  if (!argv.length) return { refused: 'Give a command, e.g. "df -h".' };
  return { argv };
}

/** A path an argument names: itself, or what follows "=" (`--env-file=…`, `EnvironmentFile=…`). */
const pathOf = (arg: string) => {
  const eq = arg.indexOf('=');
  const after = eq >= 0 ? arg.slice(eq + 1) : '';
  return eq >= 0 && (arg.startsWith('-') || /^[/~.]/.test(after)) ? after : arg;
};

/** Files whose contents are secrets: a command may use, copy or write them (#625), never print them. */
export function secretPath(arg: string): boolean {
  const p = pathOf(arg);
  const base = path.posix.basename(p).toLowerCase();
  return (
    /^\/etc\/keel(\/|$)/.test(path.posix.normalize(p)) ||
    base === '.env' ||
    base.startsWith('.env.') ||
    base.endsWith('.env') ||
    /\.(key|pem|p12|pfx)$/.test(base) ||
    /^(credentials|\.git-credentials|\.netrc|secrets\.json|id_rsa|id_ed25519|id_ecdsa|shadow|gshadow)/.test(base)
  );
}

/** The secret files a command names, as paths, for the redactor to mask what they hold. */
export const secretPaths = (argv: readonly string[]): string[] => [...new Set(argv.slice(1).filter(secretPath).map(pathOf))];

/** Programs that print a file's contents. */
const PRINTERS = new Set(['cat', 'tac', 'nl', 'less', 'more', 'head', 'tail', 'strings', 'xxd', 'od', 'hexdump', 'base64', 'base32', 'diff', 'awk', 'gawk', 'mawk', 'jq']);
const GREPS = new Set(['grep', 'egrep', 'fgrep', 'rg']);
const SAFE_LOOK = 'Check it without printing it: test -s <file>, stat <file>, or grep -c NAME= <file>.';

/** Why a command would show a secret (#625): a printer given a secret file, or the environment; null when it wouldn't. */
function printRefusal(argv: readonly string[]): string | null {
  const [program, ...args] = argv;
  if (program === 'env' || program === 'printenv') return `${program} prints the environment, secrets included. ${SAFE_LOOK}`;
  if (program === 'docker') {
    const words = args.filter((a) => !a.startsWith('-'));
    if (words.includes('inspect')) return `docker inspect prints containers' environments, secrets included: use docker ps for what runs, and test -s or stat for their env files.`;
    if (words[0] === 'compose' && words.includes('config') && !args.some((a) => a === '-q' || a === '--quiet')) return 'docker compose config prints the env files filled in: validate it with docker compose config --quiet.';
  }
  const secret = args.find(secretPath);
  if (!secret) return null;
  const shown = (why: string) => `${why} would print ${pathOf(secret)}, which holds secrets: they're used, never shown. ${SAFE_LOOK}`;
  if (PRINTERS.has(program)) return shown(program);
  if (GREPS.has(program) && !args.some((a) => /^--(quiet|silent|count|files-with(out)?-match(es)?)$/.test(a) || /^-[a-zA-Z]*[qlLc]/.test(a))) return shown(`${program} without -q, -l or -c`);
  if (program === 'sed' && !args.some((a) => /^-[a-zA-Z]*i/.test(a) || a.startsWith('--in-place'))) return shown('sed without -i');
  return null;
}

/** Problems every command has before its program is looked at. */
function basics(argv: readonly string[]): string | null {
  if (!argv.length || !argv[0]) return 'Give a command.';
  if (argv.length > 60 || argv.some((a) => a.length > 1000 || a.includes('\0'))) return 'That command is too long.';
  if (argv[0].includes('/') || argv[0].includes('\\')) return `Name the program, not its path: "${path.posix.basename(argv[0])}".`;
  return printRefusal(argv);
}

const nice = (argv: string[], linux: boolean, seconds: number) => (linux ? ['timeout', '-k', '5', String(seconds), 'nice', '-n', '19', 'ionice', '-c3', ...argv] : argv);

/** The verb (or subcommand) is the word right after the program: an option before it could take a word as its value
 * (`systemctl -p status restart x`, `docker --config ps run …`) and leave the real verb further on. */
const verbOf = (args: readonly string[], n = 1) => (args.slice(0, n).every((a) => !a.startsWith('-')) ? args.slice(0, n).join(' ') : null);
const OPTION_FIRST = (program: string, example: string) => ({ refused: `Put ${program}'s verb first, before any option (e.g. "${example}"). ${PROPOSE}` });

// journalctl's read-only options, only in full: getopt takes any unambiguous prefix of a long option, so "--rot" is
// --rotate and "--cursor-fil" writes a file. Options taking a value consume the next word (or "=value", or "-n50").
const JOURNAL_VALUE = new Set(['-u', '--unit', '--user-unit', '-n', '--lines', '-S', '--since', '-U', '--until', '-p', '--priority', '-o', '--output', '-g', '--grep', '-t', '--identifier']);
const JOURNAL_FLAG = new Set(['-b', '--boot', '--disk-usage', '--no-hostname', '-r', '--reverse', '-k', '--dmesg', '--list-boots', '--no-pager', '--utc', '-x', '--catalog', '-q', '--quiet', '-l', '--full', '--no-full', '-a', '--all', '--system', '--user', '-e', '--pager-end', '--case-sensitive']);

/** The first journalctl option that isn't a known read-only one, given in full; null when they all are. */
function journalOddOption(args: readonly string[]): string | null {
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (!a.startsWith('-') || a === '-') continue; // a match like _SYSTEMD_UNIT=x, or a value consumed below
    const eq = a.indexOf('=');
    const name = a.startsWith('--') && eq > 0 ? a.slice(0, eq) : a;
    if (name !== a) {
      if (JOURNAL_VALUE.has(name) || name === '--boot') continue;
      return name;
    }
    if (JOURNAL_VALUE.has(a)) {
      i++;
      continue;
    }
    if (JOURNAL_FLAG.has(a)) continue;
    if (/^-[unpogtbSU]./.test(a) && (JOURNAL_VALUE.has(a.slice(0, 2)) || a.startsWith('-b'))) continue; // -n50, -uX, -b-1
    return a;
  }
  return null;
}

/** it_run's command: the argv to run, or why not (pointing to it_propose for changes). */
export function readOnlyPlan(argv: readonly string[], o: { linux: boolean }): ReadPlan | Refusal {
  const bad = basics(argv);
  if (bad) return { refused: bad };
  const [program, ...args] = argv;
  const plain = { argv: [...argv], timeoutMs: READ_TIMEOUT_MS };
  const changes = (what: string) => ({ refused: `${what} changes the machine; it_run only reads. ${PROPOSE}` });
  switch (program) {
    case 'df':
    case 'free':
    case 'ls':
    case 'stat':
    case 'ps':
    case 'uptime':
    case 'lsblk':
      return plain;
    case 'mount': {
      const rest = args.filter((a) => a !== '-l');
      return !rest.length || (rest.length === 2 && rest[0] === '-t') ? plain : changes('mount with a device or folder');
    }
    case 'du':
      return { argv: nice(['du', '-x', ...args.filter((a) => a !== '-x')], o.linux, READ_TIMEOUT_MS / 1000), timeoutMs: READ_TIMEOUT_MS + 10_000 };
    case 'find': {
      const act = args.find((a) => /^-(exec|execdir|ok|okdir|delete|fprint|fprint0|fprintf|fls)$/.test(a));
      if (act) return changes(`find ${act}`);
      return { argv: nice([...argv], o.linux, READ_TIMEOUT_MS / 1000), timeoutMs: READ_TIMEOUT_MS + 10_000 };
    }
    case 'systemctl': {
      if (args[0]?.startsWith('-')) return OPTION_FIRST('systemctl', 'systemctl status caddy -n 50');
      const verb = verbOf(args);
      if (!verb || !['status', 'is-active', 'is-enabled', 'list-units', 'list-timers', 'cat'].includes(verb)) return changes(`systemctl ${verb ?? ''}`.trim());
      return { argv: ['systemctl', '--no-pager', ...args], timeoutMs: READ_TIMEOUT_MS };
    }
    case 'journalctl': {
      if (args.some((a) => a === '-f' || a === '--follow')) return { refused: "journalctl --follow never ends: ask for the last lines with -n." };
      const odd = journalOddOption(args);
      if (odd) return { refused: `journalctl ${odd} isn't one of the read-only options it_run takes, written in full (-u, -n, --since, --until, -p, -b, -o, -g, -k, -r, --disk-usage, --list-boots, --no-hostname). ${PROPOSE}` };
      const lines = args.includes('--disk-usage') || args.some((a) => a === '-n' || a.startsWith('--lines') || /^-n\d+$/.test(a)) ? [] : ['-n', '200'];
      return { argv: ['journalctl', '--no-pager', ...args, ...lines], timeoutMs: READ_TIMEOUT_MS };
    }
    case 'docker': {
      if (args[0]?.startsWith('-')) return OPTION_FIRST('docker', 'docker ps -a');
      const one = verbOf(args);
      const two = verbOf(args, 2);
      if ((one && ['ps', 'images'].includes(one)) || (two && ['system df', 'volume ls', 'image ls', 'container ls'].includes(two))) return plain;
      return changes(`docker ${two ?? one ?? ''}`.trim());
    }
    case 'snap':
      return verbOf(args) === 'list' ? plain : changes(`snap ${args[0] ?? ''}`.trim());
    case 'git':
      return gitPlan(argv);
    default:
      return { refused: `"${program}" isn't on the IT desk's read-only list (${READ_LIST}). ${PROPOSE}` };
  }
}

const READ_LIST = 'df, du, free, ls, stat, find, ps, systemctl status, journalctl, docker ps, snap list, git status/log, uptime, lsblk, mount';

/** git: only status, log, remote -v and branch -vv, with -C <dir> as the only option before them (never -c). */
function gitPlan(argv: readonly string[]): ReadPlan | Refusal {
  const pre: string[] = [];
  let i = 1;
  while (i < argv.length && argv[i].startsWith('-')) {
    if (argv[i] !== '-C' || i + 1 >= argv.length) return { refused: `git ${argv[i]} isn't allowed: only "git -C <folder>" before status, log, remote or branch.` };
    pre.push('-C', argv[i + 1]);
    i += 2;
  }
  const sub = argv[i];
  const rest = argv.slice(i + 1);
  const ok =
    (sub === 'status' && rest.every((a) => a.startsWith('-'))) ||
    (sub === 'log' && !rest.some((a) => /^--output|^-o$|^--ext-diff/.test(a))) ||
    (sub === 'remote' && rest.every((a) => a === '-v' || a === '--verbose')) ||
    (sub === 'branch' && rest.every((a) => ['-v', '-vv', '-a', '-r', '--all', '--remotes', '--list', '--verbose', '--no-color'].includes(a)));
  if (!ok) return { refused: `git ${[sub, ...rest].filter(Boolean).join(' ')} isn't read-only here (status, log, remote -v, branch -vv). ${PROPOSE}` };
  return { argv: ['git', '--no-pager', ...pre, sub, ...rest], timeoutMs: READ_TIMEOUT_MS };
}

/** Programs a proposal can't be: a shell or interpreter would hide what really runs from the never-list. */
const WRAPPERS = new Set(['sh', 'bash', 'zsh', 'dash', 'fish', 'ksh', 'csh', 'sudo', 'su', 'doas', 'env', 'xargs', 'nohup', 'setsid', 'eval', 'exec', 'busybox', 'python', 'python3', 'node', 'perl', 'ruby', 'php', 'nice', 'ionice', 'timeout', 'watch', 'script', 'tmux', 'screen', 'ssh', 'crontab', 'at']);
const POWER = new Set(['shutdown', 'reboot', 'poweroff', 'halt', 'init', 'telinit']);
const WHOLE = ['/', '/root', '/opt', '/etc', '/var', '/home', '/usr', '/boot', '/srv', '/mnt'];

/** Why a change can never run, even after the manager's Run; null when it may. `office`: the live office's folders. */
export function neverRefusal(argv: readonly string[], office: { protectedDirs: string[] }): string | null {
  const bad = basics(argv);
  if (bad) return bad;
  const [program, ...args] = argv;
  const never = (what: string) => `Never, even with the manager's Run: ${what}.`;
  if (WRAPPERS.has(program)) return never(`${program} runs other commands; propose the program itself, one command per card`);
  if (program === 'pkill' || program === 'killall') return never('killing processes by name pattern (kill one pid instead)');
  if (POWER.has(program) || (program === 'systemctl' && args.some((a) => ['reboot', 'poweroff', 'halt', 'kexec', 'suspend', 'hibernate', 'rescue', 'emergency'].includes(a)))) return never('shutting down or rebooting the machine');
  if (program === 'docker') {
    if (args.includes('volume') && args.includes('prune')) return never('docker volume prune (it would remove keel-postgres\'s data)');
    if (args.includes('prune') && args.includes('--volumes')) return never('pruning docker volumes');
    if (args.some((a) => /keel[-_]?postgres/i.test(a)) && args.some((a) => ['rm', 'rmi', 'down', 'prune', 'kill', '-v', '--volumes'].includes(a))) return never('removing the keel-postgres container or its volume');
  }
  if (program === 'git' && args.includes('push') && args.some((a) => a === '-f' || a.startsWith('--force') || a === '--mirror' || a === '--delete' || a === '-d' || a.startsWith('+'))) return never('git push --force or deleting remote branches');
  for (const a of args) {
    const p = a.includes('=') && a.startsWith('-') ? a.slice(a.indexOf('=') + 1) : a;
    if (!p.startsWith('/') && !p.startsWith('~')) continue;
    const abs = path.posix.normalize(p.replace(/^~(?=\/|$)/, '/root'));
    const hit = office.protectedDirs.find((d) => abs === d || abs.startsWith(`${d}/`));
    if (hit) return never(`touching ${hit}: the live office and its state change only through its own self-update`);
  }
  if (program === 'rm' || program === 'shred') {
    const recursive = args.some((a) => a === '--recursive' || /^-[a-zA-Z]*[rR]/.test(a)) || program === 'shred';
    if (args.includes('--no-preserve-root')) return never('rm --no-preserve-root');
    const targets = args.filter((a) => !a.startsWith('-')).map((a) => path.posix.normalize(a.replace(/^~(?=\/|$)/, '/root')).replace(/(.)\/$/, '$1'));
    const whole = targets.find((t) => WHOLE.includes(t) || (t.endsWith('/*') && WHOLE.includes(t.slice(0, -2) || '/')));
    if (recursive && whole) return never(`removing ${whole} as a whole`);
  }
  return null;
}

// ---------- the redactor (#625) ----------

/** A secret as IT's output shows it: its last 4 characters at most (a short one shows none). */
const masked = (secret: string) => `••••${secret.length >= 12 ? secret.slice(-4) : ''}`;

// Key and token shapes; the secret is the whole match unless a group says which part.
const TOKEN_SHAPES: RegExp[] = [
  /\b(?:sk|pk|rk)-(?:ant-|proj-)?[A-Za-z0-9_-]{16,}/g,
  /\bsk_(?:live|test)?_?[A-Za-z0-9]{20,}/g,
  /\bgh[pousr]_[A-Za-z0-9]{20,}/g,
  /\bgithub_pat_[A-Za-z0-9_]{20,}/g,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\bAIza[0-9A-Za-z_-]{30,}/g,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g,
  /\b(?=[\w-]*\d)(?=[\w-]*[a-z])(?=[\w-]*[A-Z])[\w-]{32,}/g,
];
const PEM = /-----BEGIN ([A-Z0-9 ]+)-----[\s\S]*?(?:-----END \1-----|$)/g;
const BEARER = /\b(Bearer|Basic)(\s+)([A-Za-z0-9._~+/=-]{12,})/gi;
const ASSIGN = [
  /\b([A-Z][A-Z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD|PASSWD|PWD|CREDENTIALS?|AUTH)[A-Z0-9_]*)(["']?\s*[=:]\s*["']?)([^\s"',;}]{6,})/g,
  /\b(api[_-]?key|access[_-]?token|auth[_-]?token|client[_-]?secret|secret|password|passwd|token)(["']?\s*[=:]\s*["']?)([^\s"',;}]{6,})/gi,
];

/** `text` with every known secret value, key-shaped token, PEM block and secret-named assignment as ••••last4. */
export function itRedact(text: string, secrets: readonly string[]): string {
  let out = text;
  for (const v of [...new Set(secrets)].filter((x) => x && x.length >= 6).sort((a, b) => b.length - a.length)) if (out.includes(v)) out = out.split(v).join(masked(v));
  out = out.replace(PEM, (_m, kind: string) => `-----BEGIN ${kind}----- •••• -----END ${kind}-----`);
  out = out.replace(BEARER, (_m, how: string, sp: string, v: string) => `${how}${sp}${masked(v)}`);
  for (const re of ASSIGN) out = out.replace(re, (m, name: string, eq: string, v: string) => (v.startsWith('••••') ? m : `${name}${eq}${masked(v)}`));
  for (const re of TOKEN_SHAPES) out = out.replace(re, (v) => masked(v));
  return out;
}

/** The values a secret file holds, for the redactor: each NAME=value's value, and every line of anything else (a key). */
export function secretValues(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#') || line.startsWith('-----')) continue;
    const m = line.match(/^(?:export\s+)?[A-Za-z_][A-Za-z0-9_.-]*\s*=\s*(.*)$/);
    const v = (m ? m[1] : line).trim().replace(/^(["'])(.*)\1$/, '$2');
    if (v.length >= 6) out.push(v);
  }
  return out;
}

/** it_run's sort: human sizes ("1.2G", "512K", or plain numbers) biggest first, by each line's first word. */
export function sortBySize(lines: string[]): string[] {
  const unit: Record<string, number> = { '': 1, B: 1, K: 1024, M: 1024 ** 2, G: 1024 ** 3, T: 1024 ** 4, P: 1024 ** 5 };
  const size = (l: string) => {
    const m = l.trim().match(/^(\d+(?:[.,]\d+)?)([KMGTPB]?)i?B?\b/i);
    return m ? Number(m[1].replace(',', '.')) * (unit[m[2].toUpperCase()] ?? 1) : -1;
  };
  return [...lines].sort((a, b) => size(b) - size(a));
}

/** What a command printed, as the CEO and the chat see it: sorted and limited when asked, masked, cut at `max`. */
export function shapeOutput(o: { out: string; err: string; sort?: 'size'; lines?: number; mask: (s: string) => string; max?: number }): string {
  let lines = o.out.split(/\r?\n/);
  if (lines.at(-1) === '') lines.pop();
  if (o.sort === 'size') lines = sortBySize(lines);
  const total = lines.length;
  if (o.lines && total > o.lines) lines = [...lines.slice(0, o.lines), `… ${total - o.lines} more lines`];
  const err = o.err.trim() ? `\n[stderr]\n${o.err.trim()}` : '';
  const text = o.mask(lines.join('\n') + err);
  const max = o.max ?? OUT_MAX;
  return text.length > max ? `${text.slice(0, max)}\n… cut at ${Math.round(max / 1000)} KB (${text.length - max} more characters)` : text;
}
