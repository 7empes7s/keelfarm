// IT auto-approve (#585): which of IT's it_propose changes run at once, without the manager's tap. Off: none (every
// change is a card). Routine: read-only commands and a fixed list of reversible, scoped shapes (git fetch / pull
// --ff-only in a clone, systemctl start/restart/enable of units IT installed itself, installing a unit or Caddy site,
// caddy reload right after caddy validate). Everything except dangerous: any change the danger list doesn't name.
// The danger list (data, databases, git beyond a few safe subcommands, overwrites by copies, downloads and archives,
// backups, disks, firewall, users and SSH, kills, KEEL, the live office) is always a card, and
// so is a change past AUTO_STEPS_MAX in one job. Matched on argv shapes, never on free text. Pure.
import path from 'node:path';
import type { ItAutoLevel } from '../shared/itDept.ts';
import type { ItLogEntry } from '../shared/itDesk.ts';
import { neverRefusal, readOnlyPlan } from './itDesk.ts';

/** Auto steps in one change (one IT job); past it, IT asks. */
export const AUTO_STEPS_MAX = 20;
/** Where an install's previous file is kept, so Undo can put it back. */
const IT_BACKUP_DIR = '/var/backups/cubefarm-it';

export interface AutoContext {
  level: ItAutoLevel;
  protectedDirs: string[];
  /** Units IT installed itself (with an auto install), e.g. "clipfarm.service". */
  itUnits: readonly string[];
  /** The office's own systemd units: never started, stopped or restarted by IT. */
  officeUnits: readonly string[];
  /** Auto steps already taken in this change. */
  steps: number;
  /** The IT desk's log, newest first: caddy reload needs a caddy validate just before. */
  log: readonly Pick<ItLogEntry, 'argv' | 'code'>[];
  /** Whether a file exists (installs back up what they replace, and never override a unit IT didn't install). */
  exists: (p: string) => boolean;
  /** A stamp for backup file names. */
  stamp: string;
  linux: boolean;
}

/** What to run first (its output feeds the undo), and the undo: argv lines run one after another on the manager's Undo. */
export interface AutoPlan {
  auto: true;
  shape: string;
  argv: string[];
  timeoutMs?: number;
  before?: string[];
  undo: (beforeOut: string) => string[][] | null;
  unit?: string; // a unit this install makes IT's own
}
export type AutoVerdict = AutoPlan | { auto: false; why: string };

const no = (why: string): AutoVerdict => ({ auto: false, why });
const none = () => null;
const UNIT_RE = /^[\w@.:-]+\.(service|timer|socket|path)$/;
const unitName = (u: string) => (/\.(service|timer|socket|path|target|mount)$/.test(u) ? u : `${u}.service`);
const UNIT_DIRS = ['/etc/systemd/system', '/lib/systemd/system', '/usr/lib/systemd/system'];
const abs = (p: string) => p.startsWith('/') && !p.split('/').includes('..') && path.posix.normalize(p) === p;

// ---------- the danger list ----------

const DATA = new Set(['rm', 'rmdir', 'unlink', 'shred', 'truncate', 'dd', 'srm', 'wipe', 'mv']);
const DISK = /^(mkfs(\..+)?|mkswap|fdisk|sfdisk|cfdisk|gdisk|sgdisk|parted|partprobe|wipefs|mount|umount|swapon|swapoff|resize2fs|e2fsck|fsck(\..+)?|tune2fs|xfs_\w+|btrfs|zpool|zfs|cryptsetup|mdadm|losetup|(pv|vg|lv)\w+)$/;
const FIREWALL = /^(ufw|iptables(-\w+)?|ip6tables(-\w+)?|nft|firewall-cmd|ebtables|arptables)$/;
const USERS = /^(useradd|userdel|usermod|adduser|deluser|addgroup|delgroup|groupadd|groupdel|groupmod|passwd|chpasswd|chage|chsh|gpasswd|visudo|vipw|newusers|ssh-keygen|ssh-copy-id|ssh-add|sshd|loginctl)$/;
const KILL = /^(kill|pkill|killall|skill|xkill)$/;
/** Programs that run another command (beyond server/itDesk.ts' WRAPPERS, which the never-list refuses): what really runs
 * would hide from this list, so they're always a card. */
const RUNS_OTHERS = /^(systemd-run|chroot|runuser|setpriv|flock|stdbuf|unbuffer|nsenter|unshare|chrt|taskset|strace|ltrace|gdb|pkexec|sg|newgrp|machinectl|run-parts|start-stop-daemon|parallel|make|expect|[gmn]?awk|sed|ed|ex|vi|vim|nvim|less|more|lua\S*|tclsh|wish|ruby\S*|perl\S*|python\S*|php\S*|node|deno|bun|nohup|setsid|xargs|watch|script|env|nice|ionice|timeout|sudo|su|doas|sh|bash|zsh|dash|ksh|fish|csh|tcsh|busybox|toybox)$/;
/** Database clients and data tools: their argument is a command in another language (DROP DATABASE, FLUSHALL), so
 * they're always a card, wherever they're named (docker exec pg dropdb app too). */
const DATABASES = /^(psql|pg_ctl\w*|pg_restore|pg_upgrade|dropdb|dropuser|createuser|mysql|mariadb|mysqladmin|mysqlimport|sqlite3?|mongo|mongosh|mongorestore|redis-cli|valkey-cli|cqlsh|influx|clickhouse(-client)?|etcdctl)$/;
/** git subcommands that can't throw work away; every other one is a card. */
const GIT_SAFE = new Set(['fetch', 'pull', 'clone', 'status', 'log', 'diff', 'show', 'checkout', 'switch']);
/** Short options that take a value (the rest of the cluster, or the next argument), for reading where a download writes. */
const CURL_ARG = 'AbcCdDeEFHKmoPQrtTuUwxXyYz';
const WGET_ARG = 'aAbBDeiIloOPQRtTUwXY';
/** Each option of a command as [name, value]: `-xzf a` gives x, z, f=a when f takes a value; `--out=x` / `--out x`. */
function optionsOf(args: readonly string[], shortArg: string, longArg: readonly string[]): [string, string | undefined][] {
  const out: [string, string | undefined][] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--') break;
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      if (eq > 0) out.push([a.slice(0, eq), a.slice(eq + 1)]);
      else out.push([a, longArg.includes(a) ? args[++i] : undefined]);
    } else if (a.startsWith('-') && a.length > 1) {
      for (let j = 1; j < a.length; j++) {
        if (!shortArg.includes(a[j])) {
          out.push([a[j], undefined]);
          continue;
        }
        out.push([a[j], a.slice(j + 1) || args[++i]]);
        break;
      }
    }
  }
  return out;
}
/** Files a download writes, or why it's a card anyway (it names its own file, or a config could). */
function downloadOf(program: string, args: readonly string[]): string[] | string | null {
  if (program === 'curl') {
    const o = optionsOf(args, CURL_ARG, ['--output', '--dump-header', '--cookie-jar', '--trace', '--trace-ascii', '--stderr', '--config', '--header', '--data', '--request', '--user', '--url']);
    if (o.some(([k]) => ['O', 'J', 'K', '--remote-name', '--remote-name-all', '--remote-header-name', '--config', '--output-dir'].includes(k))) return 'curl saves under a name of its own choosing';
    return o.filter(([k]) => ['o', 'D', 'c', '--output', '--dump-header', '--cookie-jar', '--trace', '--trace-ascii', '--stderr'].includes(k)).map(([, v]) => v ?? '');
  }
  if (program === 'wget') {
    const o = optionsOf(args, WGET_ARG, ['--output-document', '--output-file', '--execute', '--directory-prefix', '--input-file', '--config']);
    if (o.some(([k]) => ['e', 'r', 'm', 'p', 'N', '--execute', '--recursive', '--mirror', '--page-requisites', '--timestamping', '--config'].includes(k))) return 'wget replaces files it already has (-r, -m, -p, -N or -e)';
    return o.filter(([k]) => ['O', 'o', '--output-document', '--output-file'].includes(k)).map(([, v]) => v ?? '');
  }
  return null;
}
/** Extracting an archive overwrites what's already there unless told to keep old files; so does writing one onto an
 * existing file, or (de)compressing with --force. */
function archiveOver(program: string, args: readonly string[], exists: (p: string) => boolean): boolean {
  if (program === 'tar') {
    const old = args[0] && /^[a-zA-Z]+$/.test(args[0]) ? args[0].split('') : []; // tar xzf a.tgz
    const o = optionsOf(args, 'bCfFgHIKLNTVX', ['--file', '--directory', '--to-command', '--use-compress-program']);
    const flags = [...old, ...o.map(([k]) => k)];
    const file = o.find(([k]) => k === 'f' || k === '--file')?.[1] ?? (old.includes('f') ? args[1] : undefined);
    if (flags.some((k) => ['c', '--create'].includes(k)) && file && exists(file)) return true;
    if (flags.some((k) => ['--to-command', '--use-compress-program', 'I', 'F', '--info-script', '--new-volume-script', '--checkpoint-action', '--rsh-command'].includes(k))) return true; // they run programs
    const extract = flags.some((k) => ['x', '--extract', '--get'].includes(k));
    return extract && (!flags.some((k) => ['k', '--keep-old-files', '--skip-old-files'].includes(k)) || flags.includes('--overwrite'));
  }
  if (program === 'unzip') {
    const flags = optionsOf(args, 'dx', []).map(([k]) => k);
    return flags.includes('o') || !flags.some((k) => ['n', 'l', 't', 'v', 'p', 'c', 'Z'].includes(k));
  }
  if (/^(g?unzip|gzip|xz|unxz|bzip2|bunzip2|zstd|unzstd|lz4)$/.test(program) && args.some((a) => a === '--force' || /^-[a-zA-Z]*f/.test(a))) return true;
  return /^(7z[ar]?|cpio|bsdtar|unrar|unar)$/.test(program);
}
/** Copying or writing programs: onto a file that already exists, they replace it. */
const WRITES = new Set(['cp', 'install', 'ln', 'tee', 'rsync', 'scp']);

/** Every word inside the command, split at anything but name characters: a danger program named anywhere (systemd-run's
 * argument, awk's system("…"), /usr/bin/rm) counts as much as the program itself. */
const words = (argv: readonly string[]) => argv.flatMap((a) => a.split(/[^\w.+-]+/)).filter(Boolean);

/** Why a change is never run automatically, whatever the level; null when it's not on the danger list. `installs`: the
 * routine install shape matched, which backs up what it replaces. */
function dangerOf(argv: readonly string[], ctx: Pick<AutoContext, 'itUnits' | 'officeUnits' | 'exists'>, installs = false): string | null {
  const [program, ...args] = argv;
  const join = argv.join(' ');
  const all = words(argv);
  if (RUNS_OTHERS.test(program)) return `${program} runs other commands`;
  if (all.some((w) => DATA.has(w)) || (program === 'find' && args.some((a) => /^-(delete|exec|execdir|ok|okdir|fprint\w*|fls)$/.test(a)))) return 'it deletes or moves data';
  if (args.some((a) => /^--(delete|remove-source-files|remove-files|del)\b/.test(a))) return 'it deletes data (a --delete or --remove option)';
  if (args.some((a) => /^\/dev\/(null|zero|u?random|sd\w*|nvme\w*|vd\w*)$/.test(a))) return 'it writes from or to a device';
  if (/^(restic|borg|duplicity|rdiff-backup|rsnapshot)$/.test(program) || args.some((a) => /(^|\/)backups?(\/|$)|\.bak\b|backup/i.test(a))) return 'it touches backups';
  if (all.some((w) => DISK.test(w))) return 'it changes disks, partitions or mounts';
  if (all.some((w) => FIREWALL.test(w))) return 'it changes the firewall';
  if (all.some((w) => USERS.test(w)) || /(^|\s|\/)\.ssh(\/|\s|$)|\/etc\/ssh\b|authorized_keys|\bsshd?(\.service|\.socket)?$/.test(join)) return 'it touches users, passwords or SSH';
  if (all.some((w) => KILL.test(w))) return 'it kills processes';
  const db = all.find((w) => DATABASES.test(w));
  if (db) return `it runs ${db}, a database client whose commands can drop data`;
  const runner = all.find((w) => RUNS_OTHERS.test(w) && !['sg', 'ed', 'ex', 'more'].includes(w)); // short ones too common as plain words
  if (runner) return `it names ${runner}, which runs other commands`;
  if (/keel/i.test(join)) return "it touches KEEL (its live tenant, database or services)";
  if (/cubefarm/i.test(join) || args.some((a) => ctx.officeUnits.includes(unitName(a)))) return 'it touches the live office';
  if (WRITES.has(program) && !installs) {
    const files = args.filter((a) => !a.startsWith('-'));
    const targets = program === 'tee' ? files : files.slice(-1);
    const hit = targets.find((t) => ctx.exists(t));
    if (hit) return `it replaces ${hit}, which already exists, with no backup`;
  }
  const download = downloadOf(program, args);
  if (typeof download === 'string') return download;
  const over = download?.find((t) => t !== '-' && (!t || ctx.exists(t)));
  if (over !== undefined) return `it downloads over ${over || 'a file'}, which already exists`;
  if (archiveOver(program, args, ctx.exists)) return 'it writes an archive or its files over ones that already exist';
  if (program === 'rclone' && args.some((a) => ['sync', 'delete', 'deletefile', 'purge', 'rmdir', 'rmdirs', 'cleanup', 'dedupe', 'move', 'moveto'].includes(a))) return 'rclone deletes or moves files';
  if (program === 'chmod' || program === 'chown' || program === 'chgrp') return args.some((a) => /^-[a-zA-Z]*R|^--recursive/.test(a)) ? 'it changes owners or permissions recursively' : null;
  if (program === 'systemctl' || program === 'service') {
    const plain = args.filter((a) => !a.startsWith('-'));
    // systemctl <verb> <units…>; service <unit> <verb>
    const [verb, units] = program === 'systemctl' ? [plain[0] ?? '', plain.slice(1).map(unitName)] : [plain[1] ?? '', plain.slice(0, 1).map(unitName)];
    const stops = ['stop', 'kill', 'clean', 'disable', 'mask', 'isolate', 'set-default', 'edit', 'revert', 'set-property', 'link', 'preset', 'preset-all'];
    if (program === 'service') stops.push('restart', 'force-reload', 'try-restart', 'reload');
    if (stops.includes(verb) && !(units.length && units.every((u) => ctx.itUnits.includes(u)))) return `${program} ${verb} of a unit IT didn't install`;
  }
  if (/^(docker|podman|nerdctl)(-compose)?$/.test(program)) {
    const verbs = args.filter((a) => !a.startsWith('-'));
    if (verbs.some((v) => ['rm', 'rmi', 'kill', 'stop', 'down', 'volume', 'prune'].includes(v))) return 'it removes or stops containers, images or volumes';
    if (verbs.some((v) => ['exec', 'run'].includes(v))) return 'it runs a command in a container';
  }
  if (program === 'git') {
    const at = args.findIndex((a, i) => !a.startsWith('-') && args[i - 1] !== '-C');
    const [sub, rest] = [args[at] ?? '', args.slice(at + 1)];
    const words = rest.filter((a) => !a.startsWith('-'));
    const flags = rest.filter((a) => a.startsWith('-'));
    const discard = 'it can throw away work in a clone (only fetch, pull --ff-only, clone, status, log, diff, show and checkout or switch of a branch run without a tap)';
    if (args.slice(0, Math.max(at, 0)).some((a) => a.startsWith('-') && a !== '-C')) return `git options before the subcommand: ${discard}`;
    if (!GIT_SAFE.has(sub)) return `${`git ${sub}`.trim()}: ${discard}`;
    if (flags.some((f) => /^(-u|-c|--upload-pack|--config|--template|--exec)\b/.test(f))) return `git ${sub} running a program or config of its own: ${discard}`;
    if (['fetch', 'pull'].includes(sub) && (words.some((w) => /[:+]/.test(w)) || flags.some((f) => /^(-f|--force|--rebase.*|-r|--no-ff|--squash)$/.test(f)))) return `git ${sub} that rewrites a branch: ${discard}`;
    if (sub === 'pull' && !flags.includes('--ff-only')) return `git pull without --ff-only: ${discard}`;
    if (['checkout', 'switch'].includes(sub) && (words.length !== 1 || words[0] === '.' || flags.some((f) => !['-q', '--quiet'].includes(f)))) return `git ${sub} of anything but one branch: ${discard}`;
  }
  if (['apt', 'apt-get', 'aptitude', 'dpkg', 'snap', 'pip', 'pip3', 'npm'].includes(program) && args.some((a) => ['purge', '--purge', 'remove', 'autoremove', 'uninstall', '-r', '-P', '--remove'].includes(a))) return 'it removes packages';
  return null;
}

// ---------- the routine shapes ----------

/** git -C <clone> fetch …, or git -C <clone> pull --ff-only [remote [branch]] (undone by resetting to the HEAD before). */
function gitShape(argv: readonly string[]): AutoVerdict | null {
  if (argv[0] !== 'git' || argv[1] !== '-C' || !argv[2] || !abs(argv[2])) return null;
  const [dir, sub, ...rest] = argv.slice(2);
  const words = rest.filter((a) => !a.startsWith('-'));
  if (words.some((w) => /[:+]/.test(w))) return null; // a refspec could overwrite a local branch
  if (sub === 'fetch' && rest.every((a) => !a.startsWith('-') || ['--all', '--prune', '-p', '--tags', '--quiet', '-q'].includes(a)) && words.length <= 1)
    return { auto: true, shape: 'git fetch in a clone', argv: [...argv], undo: none };
  if (sub === 'pull' && rest.includes('--ff-only') && rest.every((a) => !a.startsWith('-') || ['--ff-only', '--quiet', '-q'].includes(a)) && words.length <= 2)
    return {
      auto: true,
      shape: 'git pull --ff-only in a clone',
      argv: [...argv],
      before: ['git', '-C', dir, 'rev-parse', 'HEAD'],
      undo: (out) => (/^[0-9a-f]{40}$/.test(out.trim()) ? [['git', '-C', dir, 'reset', '--keep', out.trim()]] : null),
    };
  return null;
}

/** systemctl daemon-reload, or start / restart / reload / enable [--now] of units IT installed itself. */
function systemctlShape(argv: readonly string[], ctx: AutoContext): AutoVerdict | null {
  if (argv[0] !== 'systemctl') return null;
  const [verb, ...rest] = argv.slice(1);
  if (verb === 'daemon-reload' && !rest.length) return { auto: true, shape: 'systemctl daemon-reload', argv: [...argv], undo: none };
  if (!['start', 'restart', 'reload', 'enable'].includes(verb)) return null;
  const now = rest.includes('--now');
  const units = rest.filter((a) => a !== '--now');
  if (!units.length || units.some((u) => u.startsWith('-') || !UNIT_RE.test(unitName(u)))) return null;
  if (verb !== 'enable' && now) return null;
  const mine = units.map(unitName);
  if (mine.some((u) => !ctx.itUnits.includes(u))) return no(`systemctl ${verb} of ${mine.filter((u) => !ctx.itUnits.includes(u)).join(', ')}: only units IT installed itself start without a tap`);
  const undo = verb === 'start' ? [['systemctl', 'stop', ...mine]] : verb === 'enable' ? [['systemctl', 'disable', ...(now ? ['--now'] : []), ...mine]] : null;
  return { auto: true, shape: `systemctl ${verb} of IT's own unit`, argv: [...argv], undo: () => undo };
}

/** install [-m 644] <file> <target> (or cp): a unit file into /etc/systemd/system, or a Caddy site into /etc/caddy. */
function installShape(argv: readonly string[], ctx: AutoContext): AutoVerdict | null {
  let rest: string[];
  if (argv[0] === 'install') {
    rest = argv.slice(1);
    if (rest[0] === '-m') {
      if (!['644', '0644'].includes(rest[1])) return null;
      rest = rest.slice(2);
    }
  } else if (argv[0] === 'cp') rest = argv.slice(1);
  else return null;
  if (rest.length !== 2 || rest.some((a) => a.startsWith('-') || !abs(a))) return null;
  const [src, target] = rest;
  if (/^\/(tmp|dev|proc|sys|run)(\/|$)/.test(src)) return no(`${src}: install from a clone's merged runbook, not a scratch folder`);
  const dir = path.posix.dirname(target);
  const base = path.posix.basename(target);
  const unit = dir === '/etc/systemd/system' && UNIT_RE.test(base);
  const caddy = target === '/etc/caddy/Caddyfile' || (/^\/etc\/caddy\/[\w.-]+$/.test(dir) && /^[\w.-]+$/.test(base));
  if (!unit && !caddy) return null;
  const foreign = unit && !ctx.itUnits.includes(base) && UNIT_DIRS.some((d) => ctx.exists(path.posix.join(d, base)));
  if (foreign && ctx.level === 'routine') return no(`${base} already exists and IT didn't install it: replacing it needs the manager's tap`);
  const own = unit && !foreign ? { unit: base } : {};
  const keep = ctx.exists(target);
  const install = argv[0] === 'install' ? [...argv] : ['install', '-m', '0644', src, target];
  if (keep) {
    const backup = path.posix.join(IT_BACKUP_DIR, `${base}.${ctx.stamp}`);
    return { auto: true, shape: unit ? 'replacing IT\'s own unit file' : 'replacing a Caddy file', argv: install, before: ['install', '-D', '-p', '-m', '0644', target, backup], undo: () => [['install', '-p', '-m', '0644', backup, target]], ...own };
  }
  return {
    auto: true,
    shape: unit ? 'installing a new unit' : 'installing a new Caddy file',
    argv: install,
    undo: () => (unit ? [['systemctl', 'disable', '--now', base], ['rm', target], ['systemctl', 'daemon-reload']] : [['rm', target]]),
    ...own,
  };
}

const caddyConfig = (args: readonly string[]) => {
  const i = args.findIndex((a) => a === '--config' || a === '-c');
  return i >= 0 ? args[i + 1] : '/etc/caddy/Caddyfile';
};
/** Only --config <file> and --adapter caddyfile, as pairs. */
function caddyOk(args: readonly string[]): boolean {
  if (args.length % 2) return false;
  for (let i = 0; i < args.length; i += 2) {
    const [flag, value] = [args[i], args[i + 1]];
    if ((flag === '--config' || flag === '-c') && abs(value)) continue;
    if ((flag === '--adapter' || flag === '-a') && value === 'caddyfile') continue;
    return false;
  }
  return true;
}

/** caddy validate (it only reads); caddy reload only when the IT desk's last caddy step was a validate of the same file that passed. */
function caddyShape(argv: readonly string[], ctx: AutoContext): AutoVerdict | null {
  if (argv[0] !== 'caddy' || !['validate', 'reload'].includes(argv[1]) || !caddyOk(argv.slice(2))) return null;
  const config = caddyConfig(argv.slice(2));
  if (argv[1] === 'validate') return { auto: true, shape: 'caddy validate', argv: [...argv], undo: none };
  const last = ctx.log.find((e) => e.argv[0] === 'caddy' || ((e.argv[0] === 'install' || e.argv[0] === 'cp') && e.argv.some((a) => a.startsWith('/etc/caddy/'))));
  if (!last || last.argv[1] !== 'validate' || last.code !== 0 || caddyConfig(last.argv.slice(2)) !== config) return no('caddy reload runs by itself only right after a caddy validate of the same file passed: validate first');
  return { auto: true, shape: 'caddy reload after caddy validate', argv: [...argv], undo: none };
}

/** Whether this change runs now (and how), or goes on a card (and why). The never-list's refusals never get here. */
export function autoVerdict(argv: readonly string[], ctx: AutoContext): AutoVerdict {
  if (ctx.level === 'off') return no('auto-approve is off');
  const never = neverRefusal(argv, { protectedDirs: ctx.protectedDirs });
  if (never) return no(never);
  if (ctx.steps >= AUTO_STEPS_MAX) return no(`${AUTO_STEPS_MAX} automatic steps in this change already: the rest wait for the manager`);
  const read = readOnlyPlan(argv, { linux: ctx.linux });
  if (!('refused' in read)) return { auto: true, shape: 'read-only', argv: read.argv, timeoutMs: read.timeoutMs, undo: none };
  const install = installShape(argv, ctx);
  const danger = dangerOf(argv, ctx, !!install?.auto);
  if (danger) return no(`never automatic: ${danger}`);
  const shaped = gitShape(argv) ?? systemctlShape(argv, ctx) ?? install ?? caddyShape(argv, ctx);
  if (shaped?.auto || (shaped && ctx.level === 'routine')) return shaped;
  if (ctx.level === 'all') return { auto: true, shape: 'not on the danger list', argv: [...argv], undo: none };
  return no("not one of the routine shapes (git fetch/pull --ff-only, IT's own units, installing a unit or Caddy file, caddy validate/reload)");
}
