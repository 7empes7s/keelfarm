import { describe, expect, it } from 'vitest';
import { AUTO_STEPS_MAX, autoVerdict, type AutoContext } from './itAuto.ts';
import { itDeptSettings, IT_DEPT_DEFAULTS } from '../shared/itDept.ts';
import { loadItDesk } from '../shared/itDesk.ts';

const ctx = (o: Partial<AutoContext> = {}): AutoContext => ({
  level: 'routine',
  protectedDirs: ['/root/Projects/keelfarm', '/root/.cubefarm'],
  itUnits: ['clipfarm.service'],
  officeUnits: ['cubefarm.service'],
  steps: 0,
  log: [],
  exists: () => false,
  stamp: '20261112120000',
  linux: true,
  ...o,
});
const auto = (argv: string[], o?: Partial<AutoContext>) => autoVerdict(argv, ctx(o)).auto;

describe('IT auto-approve: the routine shapes run without a tap', () => {
  it.each([
    [['df', '-h']],
    [['systemctl', 'status', 'caddy']],
    [['git', '-C', '/opt/clipfarm', 'fetch']],
    [['git', '-C', '/opt/clipfarm', 'fetch', '--prune', 'origin']],
    [['git', '-C', '/opt/clipfarm', 'pull', '--ff-only']],
    [['systemctl', 'daemon-reload']],
    [['systemctl', 'start', 'clipfarm.service']],
    [['systemctl', 'restart', 'clipfarm']],
    [['systemctl', 'enable', '--now', 'clipfarm.service']],
    [['install', '-m', '0644', '/opt/clipfarm/deploy/clipfarm.service', '/etc/systemd/system/clipfarm.service']],
    [['install', '-m', '644', '/opt/clipfarm/deploy/clipfarm.caddy', '/etc/caddy/sites/clipfarm.caddy']],
    [['cp', '/opt/clipfarm/deploy/Caddyfile', '/etc/caddy/Caddyfile']],
    [['caddy', 'validate', '--config', '/etc/caddy/Caddyfile']],
  ])('%j → auto', (argv) => expect(auto(argv)).toBe(true));

  it('caddy reload only right after a caddy validate of the same file passed', () => {
    const reload = ['caddy', 'reload', '--config', '/etc/caddy/Caddyfile'];
    const validated = { argv: ['caddy', 'validate', '--config', '/etc/caddy/Caddyfile'], code: 0 };
    expect(auto(reload)).toBe(false);
    expect(auto(reload, { log: [validated] })).toBe(true);
    expect(auto(reload, { log: [{ ...validated, code: 1 }] })).toBe(false);
    expect(auto(reload, { log: [{ argv: ['install', '/x/Caddyfile', '/etc/caddy/Caddyfile'], code: 0 }, validated] })).toBe(false); // changed since
    expect(auto(['caddy', 'reload', '--config', '/etc/caddy/Other'], { log: [validated] })).toBe(false);
  });

  it('gives an undo where one exists', () => {
    const start = autoVerdict(['systemctl', 'enable', '--now', 'clipfarm.service'], ctx());
    expect(start.auto && start.undo('')).toEqual([['systemctl', 'disable', '--now', 'clipfarm.service']]);
    const pull = autoVerdict(['git', '-C', '/opt/clipfarm', 'pull', '--ff-only'], ctx());
    expect(pull.auto && pull.before).toEqual(['git', '-C', '/opt/clipfarm', 'rev-parse', 'HEAD']);
    expect(pull.auto && pull.undo(`${'a'.repeat(40)}\n`)).toEqual([['git', '-C', '/opt/clipfarm', 'reset', '--keep', 'a'.repeat(40)]]);
    const fresh = autoVerdict(['install', '-m', '0644', '/opt/c/new.service', '/etc/systemd/system/new.service'], ctx());
    expect(fresh).toMatchObject({ auto: true, unit: 'new.service' });
    expect(fresh.auto && fresh.undo('')).toEqual([['systemctl', 'disable', '--now', 'new.service'], ['rm', '/etc/systemd/system/new.service'], ['systemctl', 'daemon-reload']]);
    // Replacing a file backs it up first, and the undo puts it back.
    const caddy = autoVerdict(['cp', '/opt/c/Caddyfile', '/etc/caddy/Caddyfile'], ctx({ exists: (p) => p === '/etc/caddy/Caddyfile' }));
    expect(caddy.auto && caddy.argv).toEqual(['install', '-m', '0644', '/opt/c/Caddyfile', '/etc/caddy/Caddyfile']);
    expect(caddy.auto && caddy.before).toEqual(['install', '-D', '-p', '-m', '0644', '/etc/caddy/Caddyfile', '/var/backups/cubefarm-it/Caddyfile.20261112120000']);
    expect(caddy.auto && caddy.undo('')).toEqual([['install', '-p', '-m', '0644', '/var/backups/cubefarm-it/Caddyfile.20261112120000', '/etc/caddy/Caddyfile']]);
  });
});

describe('IT auto-approve: the danger list is always a card', () => {
  it.each([
    [['rm', '/var/log/old.log']],
    [['rm', '-rf', '/opt/clipfarm/tmp']],
    [['find', '/var/log', '-name', '*.gz', '-delete']],
    [['install', '-m', '0644', '/opt/backups/x.service', '/etc/systemd/system/x.service']],
    [['truncate', '-s', '0', '/var/log/syslog']],
    [['parted', '/dev/sda', 'resizepart', '1', '100%']],
    [['mkfs.ext4', '/dev/sdb']],
    [['umount', '/mnt/work']],
    [['ufw', 'allow', '8080']],
    [['iptables', '-F']],
    [['useradd', 'bob']],
    [['passwd', 'root']],
    [['systemctl', 'restart', 'ssh']],
    [['cp', '/opt/x/sshd_config', '/etc/ssh/sshd_config']],
    [['kill', '1234']],
    [['systemctl', 'restart', 'keel-portal']],
    [['docker', 'restart', 'keel-postgres']],
    [['git', '-C', '/opt/keel', 'pull', '--ff-only']],
    [['systemctl', 'restart', 'cubefarm']],
    [['systemctl', 'stop', 'cubefarm.service']],
    [['systemctl', 'stop', 'caddy']],
    [['systemctl', 'disable', 'nginx']],
    [['docker', 'rm', '-f', 'web']],
    [['docker', 'system', 'prune', '-af']],
    [['git', '-C', '/opt/clipfarm', 'push']],
    [['git', '-C', '/opt/clipfarm', 'reset', '--hard', 'origin/main']],
    [['chown', '-R', 'www-data', '/var/www']],
    [['apt-get', 'purge', 'nginx']],
    [['pkill', '-f', 'node']], // CLAUDE.md's hard rules: the never-list
    [['cat', '/etc/keel/gh.env']],
    [['git', '-C', '/root/Projects/keelfarm', 'pull', '--ff-only']],
    // #591 QA: commands that run other commands, and data-deleting flags
    [['systemd-run', 'ufw', 'disable']],
    [['systemd-run', 'rm', '-rf', '/var/lib/postgresql']],
    [['chroot', '/', 'ufw', 'disable']],
    [['runuser', '-u', 'root', '--', 'rm', '-rf', '/srv/data']],
    [['flock', '/var/lock/x', 'rm', '-rf', '/srv/data']],
    [['stdbuf', '-o0', 'iptables', '-F']],
    [['awk', 'BEGIN{system("ufw disable")}']],
    [['setpriv', '--reuid=0', 'true']],
    [['nsenter', '-t', '1', '-m', 'true']],
    [['strace', '-f', 'true']],
    [['frobnicate', '--run', '/usr/bin/rm']],
    [['frobnicate', 'exec', 'bash']],
    [['rsync', '-a', '--delete', '/srv/a/', '/srv/b/']],
    [['rsync', '-a', '--remove-source-files', '/srv/a/', '/srv/b/']],
    [['tar', '--remove-files', '-czf', '/srv/a.tgz', '/srv/a']],
    [['mv', '/srv/data', '/srv/old']],
    [['cp', '/dev/null', '/etc/hosts']],
    [['cp', '/opt/x/hosts', '/etc/hosts']], // replaces a file that exists, outside the install shape
    [['install', '-m', '0755', '/opt/x/run.sh', '/usr/local/bin/run.sh']],
    [['tee', '/etc/hosts']],
    [['service', 'nginx', 'stop']],
    [['service', 'nginx', 'restart']],
    [['apt', 'remove', '-y', 'postgresql']],
    [['apt-get', 'autoremove', '-y']],
    // #591 QA round 2: database clients, git that throws work away, downloads and archives over existing files
    [['psql', '-c', 'DROP DATABASE app']],
    [['dropdb', 'app']],
    [['mysql', '-e', 'drop database x']],
    [['sqlite3', '/srv/app.db', 'DELETE FROM users']],
    [['redis-cli', 'FLUSHALL']],
    [['mongosh', '--eval', 'db.dropDatabase()']],
    [['docker', 'exec', 'pg', 'dropdb', 'app']],
    [['docker', 'compose', 'exec', 'db', 'psql']],
    [['docker', 'exec', 'web', '/opt/cleanup']],
    [['docker-compose', 'down', '-v']],
    [['docker', 'rmi', 'web']],
    [['git', '-C', '/opt/x', 'restore', '.']],
    [['git', '-C', '/opt/x', 'checkout', '--', 'file']],
    [['git', '-C', '/opt/x', 'checkout', 'HEAD', 'file']],
    [['git', '-C', '/opt/x', 'checkout', '-B', 'main']],
    [['git', '-C', '/opt/x', 'switch', '--discard-changes', 'main']],
    [['git', '-C', '/opt/x', 'branch', '-f', 'main', 'HEAD~5']],
    [['git', '-C', '/opt/x', 'update-ref', '-d', 'refs/heads/main']],
    [['git', '-C', '/opt/x', 'gc', '--prune=now']],
    [['git', '-C', '/opt/x', 'reflog', 'expire', '--expire=now', '--all']],
    [['git', '-C', '/opt/x', 'worktree', 'remove', '/opt/y']],
    [['git', '-C', '/opt/x', 'rm', 'file']],
    [['git', '-C', '/opt/x', 'filter-branch', 'HEAD']],
    [['git', '-C', '/opt/x', 'pull']],
    [['git', '-C', '/opt/x', 'pull', '--ff-only', '--rebase']],
    [['git', '-C', '/opt/x', 'fetch', 'origin', '+main:main']],
    [['git', '-c', 'core.hooksPath=/opt/h', '-C', '/opt/x', 'status']],
    [['curl', '-o', '/etc/hosts', 'https://example.com/hosts']],
    [['curl', '-sSLo', '/etc/hosts', 'https://example.com/hosts']],
    [['curl', '--output=/etc/hosts', 'https://example.com/hosts']],
    [['curl', '-O', 'https://example.com/hosts']],
    [['wget', '-qO', '/etc/hosts', 'https://example.com/hosts']],
    [['wget', '-r', 'https://example.com/']],
    [['tar', '-xzf', '/opt/a.tgz', '-C', '/srv/data']],
    [['tar', 'xzf', '/opt/a.tgz']],
    [['tar', '-czf', '/etc/hosts', '/srv/a']],
    [['unzip', '-o', '/opt/a.zip', '-d', '/srv/data']],
    [['unzip', '/opt/a.zip', '-d', '/srv/data']],
    [['gunzip', '-f', '/srv/a.gz']],
    [['7z', 'x', '/opt/a.7z']],
    [['rclone', 'sync', '/srv/a', 'remote:b']],
    [['restic', 'forget', '--prune']],
    [['systemctl', 'clean', 'nginx']],
  ])('%j → card, even at Everything except dangerous', (argv) => {
    const exists = (p: string) => ['/etc/hosts', '/usr/local/bin/run.sh'].includes(p);
    expect(auto(argv, { exists })).toBe(false);
    expect(auto(argv, { level: 'all', exists })).toBe(false);
  });
});

describe('IT auto-approve: anything else', () => {
  it.each([
    [['apt-get', 'install', '-y', 'ffmpeg']],
    [['systemctl', 'restart', 'caddy']], // not IT's unit
    [['systemctl', 'start', 'nginx']],
    [['git', '-C', '/opt/clipfarm', 'pull']], // no --ff-only
    [['git', '-C', '/opt/clipfarm', 'fetch', 'origin', '+main:main']], // a refspec overwrites a branch
    [['git', 'pull', '--ff-only']], // no clone named
    [['install', '-m', '0755', '/opt/c/x.service', '/etc/systemd/system/x.service']],
    [['install', '-m', '0644', '/tmp/x.service', '/etc/systemd/system/x.service']],
    [['install', '-m', '0644', '/opt/c/x.conf', '/etc/nginx/nginx.conf']],
    [['journalctl', '--vacuum-size=500M']],
    [['frobnicate', '--now']],
  ])('%j → card on Routine', (argv) => expect(auto(argv)).toBe(false));

  it("never replaces a unit IT didn't install on Routine", () => {
    const argv = ['install', '-m', '0644', '/opt/c/caddy.service', '/etc/systemd/system/caddy.service'];
    expect(auto(argv, { exists: (p) => p === '/lib/systemd/system/caddy.service' })).toBe(false);
  });

  it('Everything except dangerous runs what the danger list does not name', () => {
    expect(auto(['apt-get', 'install', '-y', 'ffmpeg'], { level: 'all' })).toBe(true);
    expect(auto(['systemctl', 'restart', 'caddy'], { level: 'all' })).toBe(true);
    expect(auto(['journalctl', '--vacuum-size=500M'], { level: 'all' })).toBe(true);
    expect(auto(['cp', '/opt/x/new.conf', '/etc/new.conf'], { level: 'all' })).toBe(true); // a new file replaces nothing
    expect(auto(['service', 'clipfarm', 'restart'], { level: 'all' })).toBe(true); // IT's own unit
    // git that can't lose work, downloads and archives that replace nothing
    expect(auto(['git', '-C', '/opt/x', 'checkout', 'main'], { level: 'all' })).toBe(true);
    expect(auto(['git', 'clone', 'https://github.com/o/r', '/opt/r'], { level: 'all' })).toBe(true);
    expect(auto(['git', '-C', '/opt/x', 'pull', '--ff-only', 'origin', 'main'], { level: 'all' })).toBe(true);
    expect(auto(['curl', '-fsSL', '-o', '/opt/new.tgz', 'https://example.com/a.tgz'], { level: 'all' })).toBe(true);
    expect(auto(['curl', '-fsS', 'https://example.com/health'], { level: 'all' })).toBe(true);
    expect(auto(['wget', '-q', 'https://example.com/a.tgz'], { level: 'all' })).toBe(true);
    expect(auto(['tar', '-xkzf', '/opt/a.tgz', '-C', '/srv/data'], { level: 'all' })).toBe(true);
    expect(auto(['unzip', '-n', '/opt/a.zip', '-d', '/srv/data'], { level: 'all' })).toBe(true);
  });

  it('Off runs nothing by itself', () => {
    expect(auto(['df', '-h'], { level: 'off' })).toBe(false);
    expect(auto(['systemctl', 'daemon-reload'], { level: 'off' })).toBe(false);
  });

  it(`stops after ${AUTO_STEPS_MAX} automatic steps in one change`, () => {
    expect(auto(['systemctl', 'daemon-reload'], { steps: AUTO_STEPS_MAX - 1 })).toBe(true);
    expect(autoVerdict(['systemctl', 'daemon-reload'], ctx({ steps: AUTO_STEPS_MAX }))).toMatchObject({ auto: false, why: expect.stringMatching(/20 automatic steps/) });
  });
});

describe('IT auto-approve: saved', () => {
  it('the switch survives a restart, and a bad value keeps what was there', () => {
    expect(IT_DEPT_DEFAULTS.autoApprove).toBe('off');
    const on = itDeptSettings(undefined, { autoApprove: 'routine' });
    const saved = JSON.parse(JSON.stringify(on));
    expect(itDeptSettings(undefined, saved).autoApprove).toBe('routine');
    expect(itDeptSettings(on, { autoApprove: 'yes please' }).autoApprove).toBe('routine');
    expect(itDeptSettings(on, { autoApprove: 'all' }).autoApprove).toBe('all');
  });

  it("keeps the units IT installed", () => {
    expect(loadItDesk({ waiting: [], log: [], units: ['clipfarm.service', 3] }).units).toEqual(['clipfarm.service']);
    expect(loadItDesk({}).units).toBeUndefined();
  });
});
