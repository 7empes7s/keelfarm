// Runbook jobs (#611): a floor's install runbook run by IT as one job. Pure parts first: the markdown's steps
// (```bash lines, ```env <file> [from <template>] with generated and Providers secrets, ```caddy <host> for a marked
// block in the Caddyfile, ```bash check for the health check), the policy (a project's own folders, units, compose
// file, clone and Caddy block run without a tap; anything else makes the whole job one card) and the summary. Then the
// runner, over a RunbookHost the office, the demo and the tests give: each step logged, backups of every file it
// replaces, stop at the first failure, the check last, and the Undo that puts it all back. Secret values never leave
// the machine: outputs show "VAR (set, ends …ab12)".
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import type { ItAutoLevel } from '../shared/itDept.ts';
import { argvLine } from '../shared/itDesk.ts';
import type { ItRunbookJob, RunbookStep, RunbookStepView, RunbookVar } from '../shared/itRunbook.ts';
import { autoVerdict } from './itAuto.ts';
import { CHANGE_TIMEOUT_MS, neverRefusal, parseCommand, readOnlyPlan } from './itDesk.ts';
import type { ItExecResult } from './itExec.ts';

const RUNBOOK_STEPS_MAX = 40;
const OUT_MAX = 2_000;
/** Backups of what a job replaced, one folder per job. */
const RUNBOOK_BACKUP_DIR = '/var/backups/cubefarm-it/runbooks';
export const CADDYFILE = '/etc/caddy/Caddyfile';
const UNIT_DIR = '/etc/systemd/system';
const PROJECT_RE = /^[a-z0-9][a-z0-9-]{1,30}$/;
const HOST_RE = /^(?=.{4,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/;
const VAR_RE = /^[A-Z_][A-Z0-9_]{0,63}$/;
const TEMPLATE_RE = /^\.env\.(example|sample|template)$/;

// ---------- parsing ----------

const abs = (p: string) => p.startsWith('/') && !p.split('/').includes('..') && path.posix.normalize(p) === p;

/** The runbook's title (its first "# " heading) and steps, or why it can't run. */
export function parseRunbook(md: string): { title: string; steps: RunbookStep[] } | { refused: string } {
  const lines = md.replace(/\r\n?/g, '\n').split('\n');
  const title = lines.find((l) => /^#\s+\S/.test(l))?.replace(/^#\s+/, '').trim().slice(0, 80) ?? '';
  const steps: RunbookStep[] = [];
  const checks: RunbookStep[] = [];
  let heading = '';
  for (let i = 0; i < lines.length; i++) {
    const h = lines[i].match(/^#{2,6}\s+(.*)$/);
    if (h) heading = h[1];
    const open = lines[i].match(/^(```+|~~~+)\s*(\S*)\s*(.*)$/);
    if (!open) continue;
    const end = lines.findIndex((l, j) => j > i && l.startsWith(open[1]) && !l.slice(open[1].length).trim());
    if (end < 0) return { refused: `The fence on line ${i + 1} is never closed.` };
    const body = lines.slice(i + 1, end);
    const [lang, info] = [open[2].toLowerCase(), open[3].trim()];
    const at = `line ${i + 1}`;
    i = end;
    if (lang === 'env') {
      const step = envStep(info, body, at);
      if ('refused' in step) return step;
      steps.push(step);
    } else if (lang === 'caddy' || lang === 'caddyfile') {
      const site = info.toLowerCase();
      if (!HOST_RE.test(site)) return { refused: `The caddy block on ${at} names no hostname: \`\`\`caddy app.example.com` };
      const text = body.join('\n').trim();
      if (!text || text.includes('cubefarm-it:') || text.split('\n')[0].trim().toLowerCase().startsWith(site) || !balanced(text)) return { refused: `The caddy block on ${at}: give the site's directives only (e.g. reverse_proxy localhost:5000); the office writes the site around them.` };
      steps.push({ kind: 'caddy', site, body: text });
    } else if (['bash', 'sh', 'shell', 'console'].includes(lang)) {
      const check = /\bcheck\b/i.test(info) || /\b(health ?)?check\b/i.test(heading);
      const r = commandSteps(body, at, check);
      if ('refused' in r) return r;
      (check ? checks : steps).push(...r.steps);
    }
  }
  const all = [...steps, ...checks];
  if (!all.length) return { refused: 'No steps: put them in ```bash, ```env or ```caddy blocks.' };
  if (all.length > RUNBOOK_STEPS_MAX) return { refused: `${all.length} steps: a runbook job runs ${RUNBOOK_STEPS_MAX} at most. Split it.` };
  return { title, steps: all };
}

/** Whether the braces close in order: a stray } would end the site early (and open another), an open { swallow the rest of the Caddyfile. */
function balanced(t: string): boolean {
  let depth = 0;
  for (const c of t) if ((depth += c === '{' ? 1 : c === '}' ? -1 : 0) < 0) return false;
  return depth === 0;
}

/** A bash block's lines as commands: comments and blanks skipped, \ continuations joined, a leading sudo dropped (IT is root), cd sets the folder for the next ones. */
function commandSteps(body: string[], at: string, check: boolean): { steps: RunbookStep[] } | { refused: string } {
  const steps: RunbookStep[] = [];
  let cwd: string | undefined;
  const joined: string[] = [];
  for (const l of body) {
    const t = l.replace(/^\s*\$\s+/, '').trimEnd();
    if (joined.length && joined[joined.length - 1].endsWith('\\')) joined[joined.length - 1] = `${joined[joined.length - 1].slice(0, -1)} ${t.trim()}`;
    else joined.push(t);
  }
  for (const raw of joined) {
    const line = raw.replace(/\s+#\s.*$/, '').trim();
    if (!line || line.startsWith('#')) continue;
    const parsed = parseCommand(line);
    if ('refused' in parsed) return { refused: `Step "${line.slice(0, 80)}" (${at}): ${parsed.refused} Write secrets with an \`\`\`env block, and one command per line.` };
    const argv = parsed.argv[0] === 'sudo' ? parsed.argv.slice(1) : parsed.argv;
    if (!argv.length) continue;
    if (argv[0] === 'cd') {
      if (argv.length !== 2 || !abs(argv[1])) return { refused: `"${line}" (${at}): cd takes one absolute folder.` };
      cwd = argv[1];
      continue;
    }
    steps.push({ kind: 'run', argv, ...(cwd && { cwd }), ...(check && { check: true as const }) });
  }
  return { steps };
}

/** ```env /opt/x/.env [from /opt/x/.env.example]: NAME=value, NAME=generate[:bytes], NAME=provider:<id>. */
function envStep(info: string, body: string[], at: string): RunbookStep | { refused: string } {
  const m = info.match(/^(\S+)(?:\s+from\s+(\S+))?$/);
  if (!m || !abs(m[1]) || (m[2] && !abs(m[2]))) return { refused: `The env block on ${at}: \`\`\`env /opt/<project>/.env [from /opt/<project>/.env.example]` };
  const vars: RunbookVar[] = [];
  for (const l of body.map((x) => x.trim()).filter((x) => x && !x.startsWith('#'))) {
    const kv = l.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!kv || !VAR_RE.test(kv[1])) return { refused: `The env block on ${at}: "${l.split('=')[0]}" isn't NAME=value.` };
    const v = kv[2].trim();
    const gen = v.match(/^generate(?::(\d+))?$/);
    const prov = v.match(/^provider:([\w-]+)$/);
    const bytes = Number(gen?.[1] ?? 32);
    if (gen && (bytes < 8 || bytes > 128)) return { refused: `The env block on ${at}: generate takes 8 to 128 bytes.` };
    vars.push({ name: kv[1], value: gen ? { generate: bytes } : prov ? { provider: prov[1].toLowerCase() } : { literal: v.replace(/^(['"])(.*)\1$/, '$2') } });
  }
  if (!vars.length && !m[2]) return { refused: `The env block on ${at} sets nothing.` };
  return { kind: 'env', file: m[1], ...(m[2] && { from: m[2] }), vars };
}

// ---------- the policy ----------

export interface RunbookScope {
  project: string;
  /** The floor's own repo, as clone URLs (https and ssh); its clone may live in /opt/<repo name>. */
  repoUrls: string[];
  repoName: string;
}

/** Where a project's own files live: /opt/<p>, /etc/<p>, its units, and the floor's clone (for git and templates). */
function inProject(p: string, s: RunbookScope, o: { clone?: boolean; units?: boolean } = {}): boolean {
  if (!abs(p)) return false;
  const under = (d: string) => p === d || p.startsWith(`${d}/`);
  if (under(`/opt/${s.project}`) || under(`/etc/${s.project}`)) return true;
  if (o.clone && under(`/opt/${s.repoName}`)) return true;
  return !!o.units && path.posix.dirname(p) === UNIT_DIR && projectUnit(path.posix.basename(p), s);
}
const unitName = (u: string) => (/\.(service|timer)$/.test(u) ? u : `${u}.service`);
const projectUnit = (u: string, s: RunbookScope) => !/^caddy\b/.test(u) && new RegExp(`^${s.project}([-.@][\\w.@-]*)?\\.(service|timer)$`).test(unitName(u));
const sameRepo = (url: string, s: RunbookScope) => {
  const norm = (u: string) => u.trim().toLowerCase().replace(/\.git$/, '').replace(/^git@github\.com:/, 'https://github.com/').replace(/\/+$/, '');
  return s.repoUrls.some((r) => norm(r) === norm(url));
};

/** Credential files a runbook's write steps may name: its own targets under the project, templates as sources. */
function writable(argv: readonly string[], s: RunbookScope): (p: string) => boolean {
  if (!['install', 'cp', 'mkdir', 'chmod', 'chown', 'touch'].includes(argv[0])) return () => false;
  const files = argv.slice(1).filter((a) => !a.startsWith('-'));
  const target = files.at(-1);
  return (p) => !/^\/etc\/keel(\/|$)/.test(p) && inProject(p, s, { clone: p !== target }) && (p === target || argv[0] === 'chmod' || argv[0] === 'chown' || TEMPLATE_RE.test(path.posix.basename(p)));
}

/** The files and folders a command writes, for backups and Undo (empty: none known). */
function writeTargets(argv: readonly string[]): string[] {
  const [program, ...args] = argv;
  const plain = args.filter((a, i) => !a.startsWith('-') && !['-m', '--mode', '-o', '-g', '--owner', '--group'].includes(args[i - 1]));
  if (program === 'install') return args.includes('-d') ? plain : plain.slice(-1);
  if (program === 'cp' || program === 'ln') return plain.slice(-1);
  if (program === 'mkdir' || program === 'touch') return plain;
  if (program === 'git' && plain[0] === 'clone') return plain.slice(2, 3);
  return [];
}

const READ_CURL = new Set(['-f', '-s', '-S', '-L', '-I', '-k', '-fs', '-fsS', '-fsSL', '-sS', '-sSf', '-sSL', '-fsSLk', '--fail', '--silent', '--show-error', '--location', '--head', '--insecure', '--retry-all-errors']);
const CURL_NUM = new Set(['-m', '--max-time', '--retry', '--retry-delay', '--connect-timeout']);

/** A project command that runs without a tap: its files, units, compose file, clone, npm scripts or a curl read. */
function projectShape(argv: readonly string[], cwd: string | undefined, s: RunbookScope): boolean {
  const [program, ...args] = argv;
  const inCwd = !!cwd && inProject(cwd, s, { clone: true });
  switch (program) {
    case 'install':
    case 'cp':
    case 'mkdir':
    case 'touch':
    case 'chmod':
    case 'chown': {
      const ok = ['-m', '-o', '-g', '-d', '-D', '-p', '-R', '--mode', '--owner', '--group'];
      if (args.some((a) => a.startsWith('-') && !ok.includes(a))) return false;
      const valued = (i: number) => ['-m', '-o', '-g', '--mode', '--owner', '--group'].includes(args[i - 1]);
      const files = args.filter((a, i) => !a.startsWith('-') && !valued(i));
      const targets = program === 'chmod' || program === 'chown' ? files.slice(1) : writeTargets(argv);
      return targets.length > 0 && targets.every((t) => inProject(t, s, { units: true }));
    }
    case 'systemctl': {
      const [verb, ...rest] = args;
      if (verb === 'daemon-reload') return !rest.length;
      const units = rest.filter((a) => a !== '--now');
      return ['enable', 'start', 'restart', 'reload', 'status', 'is-active'].includes(verb) && units.length > 0 && units.every((u) => !u.startsWith('-') && projectUnit(u, s)) && (verb === 'enable' || !rest.includes('--now'));
    }
    case 'docker': {
      if (args[0] !== 'compose') return false;
      let i = 1;
      let file = false;
      while (args[i]?.startsWith('-')) {
        if (!['-f', '--file', '--project-directory'].includes(args[i]) || !inProject(args[i + 1] ?? '', s)) return false;
        file = true;
        i += 2;
      }
      const verb = args[i];
      const rest = args.slice(i + 1);
      return (file || (!!cwd && inProject(cwd, s))) && ['up', 'pull', 'ps', 'logs', 'restart', 'build', 'config', 'start'].includes(verb) && rest.every((a) => ['-d', '--detach', '--wait', '--build', '--no-color', '--quiet-pull'].includes(a) || (!a.startsWith('-') && /^[\w.-]+$/.test(a)));
    }
    case 'git': {
      if (args[0] === 'clone') {
        const rest = args.slice(1).filter((a) => !['--depth', '1', '--quiet', '-q'].includes(a));
        return rest.length === 2 && sameRepo(rest[0], s) && inProject(rest[1], s, { clone: true });
      }
      if (args[0] !== '-C' || !inProject(args[1] ?? '', s, { clone: true })) return false;
      return (args[2] === 'fetch' && args.slice(3).every((a) => ['--quiet', '-q', '--tags', 'origin'].includes(a))) || (args[2] === 'pull' && args.includes('--ff-only') && args.slice(3).every((a) => ['--ff-only', '--quiet', '-q', 'origin'].includes(a)));
    }
    case 'npm': {
      const prefix = args[0] === '--prefix' ? args[1] : null;
      const rest = prefix ? args.slice(2) : args;
      if (!(prefix ? inProject(prefix, s, { clone: true }) : inCwd)) return false;
      return (['ci', 'install'].includes(rest[0]) && rest.slice(1).every((a) => ['--omit=dev', '--no-audit', '--no-fund'].includes(a))) || (rest[0] === 'run' && rest.length === 2 && /^[\w:.-]+$/.test(rest[1]));
    }
    case 'curl': {
      const urls: string[] = [];
      for (let i = 0; i < args.length; i++) {
        if (READ_CURL.has(args[i])) continue;
        if (CURL_NUM.has(args[i]) && /^\d+$/.test(args[i + 1] ?? '')) i++;
        else if (/^https?:\/\/[^\s]+$/.test(args[i])) urls.push(args[i]);
        else return false;
      }
      return urls.length === 1;
    }
    case 'caddy':
      return args[0] === 'validate';
    default:
      return false;
  }
}

/** Why a step can't run at all, even on the manager's Approve; null when it may. */
export function stepNever(step: RunbookStep, s: RunbookScope, protectedDirs: string[]): string | null {
  if (step.kind === 'env') {
    if (!inProject(step.file, s) || /^\/etc\/keel(\/|$)/.test(step.file)) return `${step.file}: a runbook writes env files only under /opt/${s.project} or /etc/${s.project}.`;
    if (step.from && !inProject(step.from, s, { clone: true })) return `${step.from}: the template has to be in the project's folders or its clone.`;
    return null;
  }
  if (step.kind === 'caddy') return null;
  return neverRefusal(step.argv, { protectedDirs, writable: writable(step.argv, s) });
}

export interface RunbookPolicy extends RunbookScope {
  level: ItAutoLevel;
  protectedDirs: string[];
  itUnits: readonly string[];
  officeUnits: readonly string[];
  exists: (p: string) => boolean;
  linux: boolean;
}

/** Whether the job runs without a tap: every step in the project's scope (or a routine #585 shape); else the first step that isn't, as why. */
export function runbookVerdict(steps: readonly RunbookStep[], p: RunbookPolicy): { auto: true } | { auto: false; why: string } {
  if (p.level === 'off') return { auto: false, why: 'auto-approve is off' };
  for (const [i, step] of steps.entries()) {
    if (step.kind !== 'run') continue; // env files and the Caddy block are checked by stepNever and written with backups
    if (isCaddyReload(step.argv)) continue; // the runner validates first
    if (!('refused' in readOnlyPlan(step.argv, { linux: p.linux })) || projectShape(step.argv, step.cwd, p)) continue;
    const v = autoVerdict(step.argv, { level: p.level, protectedDirs: p.protectedDirs, itUnits: p.itUnits, officeUnits: p.officeUnits, steps: 0, log: [], exists: p.exists, stamp: 'x', linux: p.linux });
    if (!v.auto) return { auto: false, why: `step ${i + 1}, \`${argvLine(step.argv)}\`: ${v.why}` };
  }
  return { auto: true };
}

const isCaddyReload = (argv: readonly string[]) => (argv[0] === 'systemctl' && argv[1] === 'reload' && argv.length === 3 && unitName(argv[2]) === 'caddy.service') || (argv[0] === 'caddy' && argv[1] === 'reload' && argv.length === 2);

/** A step as one line on the card. */
export function stepLabel(step: RunbookStep): string {
  if (step.kind === 'run') return `${step.cwd ? `(in ${step.cwd}) ` : ''}${argvLine(step.argv)}`;
  if (step.kind === 'env') return `write ${step.file}${step.from ? ` from ${path.posix.basename(step.from)}` : ''}: ${step.vars.map((v) => v.name).join(', ') || 'the template'}`;
  return `Caddy block for ${step.site} (validated before the reload)`;
}

/** "14 steps, touches /opt/postiz, a systemd unit postiz, the Caddy block for postiz.example.com". */
export function runbookSummary(steps: readonly RunbookStep[], s: RunbookScope): string {
  const dirs = new Set<string>();
  const units = new Set<string>();
  const sites: string[] = [];
  let compose = false;
  for (const step of steps) {
    if (step.kind === 'caddy') sites.push(step.site);
    const paths = step.kind === 'env' ? [step.file] : step.kind === 'run' ? writeTargets(step.argv) : [];
    for (const p of paths) {
      if (path.posix.dirname(p) === UNIT_DIR) units.add(path.posix.basename(p).replace(/\.service$/, ''));
      else dirs.add(p.split('/').slice(0, 3).join('/'));
    }
    if (step.kind === 'run' && step.argv[0] === 'docker' && step.argv[1] === 'compose') compose = true;
  }
  const parts = [`${steps.length} step${steps.length === 1 ? '' : 's'}`];
  if (dirs.size) parts.push(`touches ${[...dirs].join(', ')}`);
  if (units.size) parts.push(`${units.size === 1 ? 'a systemd unit' : 'systemd units'} ${[...units].join(', ')}`);
  if (compose) parts.push(`docker compose for ${s.project}`);
  if (sites.length) parts.push(`the Caddy block for ${sites.join(', ')}`);
  return parts.join(', ');
}

/** The machine's own components: a project named after one would make its folders and units "the project's own". */
const SYSTEM = ['ssh', 'sshd', 'openssh', 'ufw', 'firewalld', 'nftables', 'iptables', 'ip6tables', 'caddy', 'nginx', 'apache2', 'httpd', 'systemd', 'docker', 'containerd', 'podman', 'apt', 'dpkg', 'snap', 'snapd', 'sudo', 'sudoers', 'pam', 'cron', 'anacron', 'network', 'networkd', 'networking', 'netplan', 'resolv', 'resolved', 'hosts', 'cloudflared', 'postgresql', 'postgres', 'mysql', 'mariadb', 'redis', 'letsencrypt', 'certbot', 'tailscale', 'wireguard', 'wg', 'fail2ban', 'ssl', 'security', 'default', 'init', 'kernel', 'modprobe', 'sysctl', 'udev', 'polkit', 'dbus', 'logrotate', 'rsyslog', 'journald', 'audit', 'apparmor', 'selinux', 'grub', 'fstab', 'mimule', 'claude', 'it', 'backups'];

/** The scope's project name, or why not: never the office's own, KEEL or a part of the machine (ssh, ufw, caddy, systemd…). */
export function projectProblem(project: string): string | null {
  if (!PROJECT_RE.test(project)) return 'Give the project as a short lower-case name, e.g. "postiz": its folders are /opt/<project> and /etc/<project>.';
  if (/keel|cubefarm/.test(project)) return `"${project}" is the live office's or KEEL's: runbooks never touch those.`;
  const sys = SYSTEM.find((n) => project === n || project.startsWith(`${n}-`));
  if (sys) return `"${project}" is part of the machine (${sys}): a runbook's scope is a project of its own, e.g. "postiz". Changes to ${sys} go through it_propose's cards.`;
  return null;
}

/** Why the first job of a project needs the manager's Approve: its /etc folder or unit is already on the machine and IT didn't make it. Null: it's new, or IT's. */
export function projectForeign(project: string, o: { exists: (p: string) => boolean; itUnits: readonly string[]; ranBefore: boolean }): string | null {
  if (o.ranBefore) return null;
  const unit = `${project}.service`;
  const there = [`/etc/${project}`, ...['/etc/systemd/system', '/lib/systemd/system', '/usr/lib/systemd/system'].map((d) => `${d}/${unit}`)].find(o.exists);
  if (!there || (there.endsWith(unit) && o.itUnits.includes(unit))) return null;
  return `${there} is already on this machine and no runbook job made it: the first run needs your Approve`;
}

// ---------- the runner ----------

/** What a runbook job runs on: the machine (the office), a fake (the demo and the tests). */
export interface RunbookHost {
  exec(argv: string[], timeoutMs: number, cwd?: string): Promise<ItExecResult>;
  /** A file's text, or null when it doesn't exist. */
  read(p: string): Promise<string | null>;
  /** Writes atomically (temp file, then rename) with `mode`, making the parent folders. */
  write(p: string, data: string, mode: number): Promise<void>;
  /** Copies keeping the mode, making the parent folders (mode 700). */
  copy(from: string, to: string): Promise<void>;
  /** Removes a file or a folder with what's in it. */
  remove(p: string): Promise<void>;
  exists(p: string): Promise<boolean>;
}

export interface RunbookRun {
  /** Masks what the office knows is secret (Providers keys, tokens). */
  mask: (s: string) => string;
  /** A Providers key by its provider id; null when there's none. */
  key: (provider: string) => string | null;
  /** After each step: the job changed (progress for the tabs). */
  changed: (step: RunbookStepView, i: number) => void;
}

/** "ab12": the last four characters, all a card ever shows of a secret. */
const ends = (v: string) => (v.length >= 12 ? v.slice(-4) : '');
const setLine = (name: string, value: string) => `${name} (set${ends(value) ? `, ends …${ends(value)}` : ''})`;
const clip = (s: string) => (s.length > OUT_MAX ? `${s.slice(0, OUT_MAX)}\n…` : s);
const backupPath = (job: string, n: number, p: string) => path.posix.join(RUNBOOK_BACKUP_DIR, job, `${String(n).padStart(2, '0')}${p.replace(/\//g, '__')}`);

/** A file's env lines with `vars` set: lines already there replaced in place, new ones appended, the rest kept. */
export function setEnv(text: string, vars: { name: string; value: string }[]): string {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  if (lines.at(-1) === '') lines.pop();
  for (const v of vars) {
    const at = lines.findIndex((l) => new RegExp(`^\\s*(export\\s+)?${v.name}\\s*=`).test(l));
    const line = `${v.name}=${v.value}`;
    if (at >= 0) lines[at] = line;
    else lines.push(line);
  }
  return `${lines.join('\n')}\n`;
}

/** The env file's current value of `name` (unquoted), or ''. */
const envValue = (text: string, name: string) => text.match(new RegExp(`^\\s*(?:export\\s+)?${name}\\s*=\\s*(.*)$`, 'm'))?.[1].trim().replace(/^(['"])(.*)\1$/, '$2') ?? '';

/** The Caddyfile with the project's marked block set to `site { body }` (replaced if there, else appended). */
export function setCaddyBlock(text: string, project: string, site: string, body: string): string {
  const begin = `# cubefarm-it:${project} begin`;
  const end = `# cubefarm-it:${project} end`;
  const block = [begin, `${site} {`, ...body.split('\n').map((l) => `\t${l.trim()}`), '}', end].join('\n');
  const i = text.indexOf(begin);
  const j = text.indexOf(end);
  if (i >= 0 && j > i) return `${text.slice(0, i)}${block}${text.slice(j + end.length)}`;
  return `${text.replace(/\s*$/, '')}${text.trim() ? '\n\n' : ''}${block}\n`;
}

/**
 * Runs a job's steps in order (checks last, as parsed), recording every change for the Undo; stops at the first
 * failure. Mutates `job` (its steps, changes, state, check) and calls `run.changed` after each step.
 */
export async function runRunbook(job: ItRunbookJob, host: RunbookHost, run: RunbookRun): Promise<void> {
  const secrets: string[] = [];
  const mask = (s: string) => {
    let t = s;
    for (const v of secrets) if (v.length >= 6) t = t.split(v).join('[secret]');
    return run.mask(t);
  };
  const createdUnits = new Set<string>();
  const backup = async (n: number, p: string, dir = false) => {
    if (await host.exists(p)) {
      if (dir) return; // a folder already there: nothing of it changes
      if (job.changes.some((c) => c.kind === 'file' && c.path === p)) return; // the first backup is the one Undo needs
      const to = backupPath(job.id, n, p);
      await host.copy(p, to);
      job.changes.push({ kind: 'file', path: p, backup: to });
      return;
    }
    let top = p; // the highest folder this step will make, so Undo removes it all
    while (!(await host.exists(path.posix.dirname(top))) && path.posix.dirname(top) !== '/') top = path.posix.dirname(top);
    job.changes.push(top === p ? { kind: 'file', path: p } : { kind: 'dir', path: top });
    if (path.posix.dirname(p) === UNIT_DIR) createdUnits.add(path.posix.basename(p));
  };
  const exec = async (argv: string[], cwd?: string) => {
    const r = await host.exec(argv, CHANGE_TIMEOUT_MS, cwd);
    const out = [r.out.trim(), r.err.trim()].filter(Boolean).join('\n');
    return { code: r.code, out: mask(out) };
  };
  job.state = 'running';
  for (const [i, step] of job.plan.entries()) {
    const view = job.steps[i];
    view.state = 'running';
    run.changed(view, i);
    let r: { code: number | null; out: string };
    try {
      r = step.kind === 'env' ? await envRun(step, i) : step.kind === 'caddy' ? await caddyRun(step, i) : await cmdRun(step, i);
    } catch (err) {
      r = { code: null, out: mask((err as Error).message) };
    }
    Object.assign(view, { state: r.code === 0 ? 'done' : 'failed', code: r.code, out: clip(r.out) });
    if (step.kind === 'run' && step.check) job.check = { ok: r.code === 0, out: clip(r.out) };
    run.changed(view, i);
    if (r.code !== 0) {
      for (const rest of job.steps.slice(i + 1)) rest.state = 'skipped';
      job.state = 'failed';
      break;
    }
  }
  if (job.state === 'running') job.state = 'done';
  job.undoable = job.changes.length > 0;
  job.ended = Date.now();

  async function cmdRun(step: Extract<RunbookStep, { kind: 'run' }>, n: number) {
    if (isCaddyReload(step.argv)) {
      const v = await exec(['caddy', 'validate', '--config', CADDYFILE, '--adapter', 'caddyfile']);
      if (v.code !== 0) return { code: v.code, out: `caddy validate failed, so Caddy wasn't reloaded:\n${v.out}` };
    }
    const dirs = step.argv[0] === 'mkdir' || (step.argv[0] === 'install' && step.argv.includes('-d')) || step.argv[0] === 'git';
    for (const t of writeTargets(step.argv)) await backup(n, step.cwd && !t.startsWith('/') ? path.posix.join(step.cwd, t) : t, dirs);
    const r = await exec(step.argv, step.cwd);
    if (r.code !== 0) return r;
    const [program, verb, ...rest] = step.argv;
    const units = rest.filter((a) => !a.startsWith('-')).map(unitName).filter((u) => createdUnits.has(u));
    if (program === 'systemctl' && units.length && ['enable', 'start', 'restart'].includes(verb)) job.changes.push({ kind: 'cmd', argv: ['systemctl', verb === 'enable' ? 'disable' : 'stop', ...(verb === 'enable' ? ['--now'] : []), ...units] });
    const up = step.argv.indexOf('up');
    if (program === 'docker' && verb === 'compose' && up > 0) job.changes.push({ kind: 'cmd', argv: [...step.argv.slice(0, up), 'down'] });
    return r;
  }

  async function envRun(step: Extract<RunbookStep, { kind: 'env' }>, n: number) {
    const current = await host.read(step.file);
    const base = current ?? (step.from ? await host.read(step.from) : '') ?? null;
    if (base === null) return { code: 1, out: `${step.from} isn't there: clone or copy the project first.` };
    const set: { name: string; value: string }[] = [];
    const said: string[] = [];
    for (const v of step.vars) {
      const now = envValue(base, v.name);
      if ('generate' in v.value) {
        const value = current && now ? now : randomBytes(v.value.generate).toString('hex'); // kept once made: a new DB password would lock the app out
        secrets.push(value);
        set.push({ name: v.name, value });
        said.push(`${setLine(v.name, value)}${current && now ? ', kept' : ', generated'}`);
      } else if ('provider' in v.value) {
        const key = run.key(v.value.provider);
        if (!key) return { code: 1, out: `${v.name}: there's no ${v.value.provider} key in Settings → Providers. Add it there and run the job again.` };
        secrets.push(key);
        set.push({ name: v.name, value: key });
        said.push(`${setLine(v.name, key)}, from Providers (${v.value.provider})`);
      } else {
        set.push({ name: v.name, value: v.value.literal });
        said.push(setLine(v.name, v.value.literal));
      }
    }
    for (const x of base.split('\n')) {
      const value = x.match(/^\s*[A-Za-z_]\w*\s*=\s*(.+)$/)?.[1];
      if (value && value.trim().length >= 8) secrets.push(value.trim().replace(/^(['"])(.*)\1$/, '$2')); // what's there may be secret too
    }
    await backup(n, step.file);
    await host.write(step.file, setEnv(base, set), 0o600);
    return { code: 0, out: mask(`${step.file} (mode 600): ${said.join('; ') || 'from the template'}`) };
  }

  async function caddyRun(step: Extract<RunbookStep, { kind: 'caddy' }>, n: number) {
    const before = (await host.read(CADDYFILE)) ?? '';
    const known = job.changes.length;
    await backup(n, CADDYFILE);
    await host.write(CADDYFILE, setCaddyBlock(before, job.project, step.site, step.body), 0o644);
    const v = await exec(['caddy', 'validate', '--config', CADDYFILE, '--adapter', 'caddyfile']);
    if (v.code !== 0) {
      await host.write(CADDYFILE, before, 0o644); // put back at once: a broken Caddyfile would take every site down on the next reload
      job.changes.splice(known);
      return { code: v.code, out: `caddy validate failed, so the Caddyfile is back as it was:\n${v.out}` };
    }
    const r = await exec(['systemctl', 'reload', 'caddy']);
    return { code: r.code, out: `${step.site}: the block "cubefarm-it:${job.project}" is in ${CADDYFILE}, validated.\n${r.out}`.trim() };
  }
}

/** The Undo: every change in reverse (backups put back, what the job made removed, its reversing commands), then systemd and Caddy reloaded. */
export async function undoRunbook(job: ItRunbookJob, host: RunbookHost, mask: (s: string) => string): Promise<{ ok: boolean; out: string }> {
  const out: string[] = [];
  let ok = true;
  const safe = (p: string) => abs(p) && p.split('/').length >= 3 && !/keel|cubefarm/i.test(p); // never a whole /opt or /etc, KEEL or the office
  for (const c of [...job.changes].reverse()) {
    try {
      if (c.kind === 'cmd') {
        const r = await host.exec(c.argv, CHANGE_TIMEOUT_MS);
        out.push(`$ ${argvLine(c.argv)} → ${r.code === 0 ? 'ok' : `exit ${r.code}`}`);
        continue; // a stop or a compose down that fails leaves the files to put back anyway
      }
      if (!safe(c.path)) {
        out.push(`${c.path}: left alone (outside the project's folders)`);
        continue;
      }
      if (c.kind === 'file' && c.backup) {
        await host.copy(c.backup, c.path);
        out.push(`${c.path}: put back`);
      } else {
        await host.remove(c.path);
        out.push(`${c.path}: removed`);
      }
    } catch (err) {
      ok = false;
      out.push(`${'path' in c ? c.path : argvLine(c.argv)}: ${(err as Error).message}`);
    }
  }
  const touched = (p: (x: string) => boolean) => job.changes.some((c) => c.kind !== 'cmd' && p(c.path));
  if (touched((p) => path.posix.dirname(p) === UNIT_DIR)) out.push(`$ systemctl daemon-reload → ${(await host.exec(['systemctl', 'daemon-reload'], CHANGE_TIMEOUT_MS)).code === 0 ? 'ok' : 'failed'}`);
  if (touched((p) => p === CADDYFILE)) {
    const r = await host.exec(['systemctl', 'reload', 'caddy'], CHANGE_TIMEOUT_MS);
    if (r.code !== 0) ok = false;
    out.push(`$ systemctl reload caddy → ${r.code === 0 ? 'ok' : `exit ${r.code}`}`);
  }
  return { ok, out: mask(out.join('\n')) };
}
