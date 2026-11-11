import { describe, expect, it } from 'vitest';
import { neverRefusal, parseCommand, readOnlyPlan, secretPath, shapeOutput, sortBySize } from './itDesk.ts';
import { argvLine } from '../shared/itDesk.ts';

const plan = (line: string, linux = true) => {
  const p = parseCommand(line);
  return 'refused' in p ? p : readOnlyPlan(p.argv, { linux });
};
const refusedWhy = (line: string) => {
  const p = plan(line);
  return 'refused' in p ? p.refused : null;
};
const office = { protectedDirs: ['/root/Projects/keelfarm', '/root/keelfarm', '/root/.cubefarm'] };

describe('parseCommand', () => {
  it('splits words and quotes into argv', () => {
    expect(parseCommand(`find /var/log -name '*.gz' -size +10M`)).toEqual({ argv: ['find', '/var/log', '-name', '*.gz', '-size', '+10M'] });
    expect(parseCommand('ls "/opt/my dir"')).toEqual({ argv: ['ls', '/opt/my dir'] });
  });

  it.each(['du -sh /var | sort -h', 'df; rm -rf /', 'ls $(whoami)', 'ls `id`', 'df > /tmp/x', 'df && reboot', 'ls\nrm x'])('refuses shell syntax: %s', (line) => {
    const p = parseCommand(line);
    expect('refused' in p && p.refused).toMatch(/no shell/);
  });
});

describe('readOnlyPlan (it_run)', () => {
  it('runs an allowlisted read as is', () => {
    expect(plan('df -h')).toEqual({ argv: ['df', '-h'], timeoutMs: expect.any(Number) });
    expect(plan('systemctl status keel-portal')).toMatchObject({ argv: ['systemctl', '--no-pager', 'status', 'keel-portal'] });
    expect(plan('docker system df')).toMatchObject({ argv: ['docker', 'system', 'df'] });
    expect(plan('docker ps -a --format {{.Names}}')).toMatchObject({ argv: ['docker', 'ps', '-a', '--format', '{{.Names}}'] });
    expect(plan('systemctl list-units --state=failed -t service')).toMatchObject({ argv: ['systemctl', '--no-pager', 'list-units', '--state=failed', '-t', 'service'] });
    expect(plan('git -C /opt/keel branch -vv')).toMatchObject({ argv: ['git', '--no-pager', '-C', '/opt/keel', 'branch', '-vv'] });
  });

  it('keeps du on one disk, at low priority, under a timeout', () => {
    expect(plan('du -sh /var/lib')).toMatchObject({ argv: ['timeout', '-k', '5', '120', 'nice', '-n', '19', 'ionice', '-c3', 'du', '-x', '-sh', '/var/lib'] });
    expect(plan('du -x -sh /', false)).toMatchObject({ argv: ['du', '-x', '-sh', '/'] });
  });

  it('gives a unit lines when none were asked for', () => {
    expect(plan('journalctl -u caddy')).toMatchObject({ argv: ['journalctl', '--no-pager', '-u', 'caddy', '-n', '200'] });
    expect(plan('journalctl --disk-usage')).toMatchObject({ argv: ['journalctl', '--no-pager', '--disk-usage'] });
    expect(plan('journalctl -u keel-portal -n 50 --since=-1h -p err -o short-iso')).toMatchObject({ argv: ['journalctl', '--no-pager', '-u', 'keel-portal', '-n', '50', '--since=-1h', '-p', 'err', '-o', 'short-iso'] });
    expect(plan('journalctl -n50 -b -k _SYSTEMD_UNIT=caddy.service')).toMatchObject({ argv: ['journalctl', '--no-pager', '-n50', '-b', '-k', '_SYSTEMD_UNIT=caddy.service'] });
  });

  it.each(['rm -rf /tmp/x', 'systemctl restart caddy', 'docker image prune', 'journalctl --vacuum-size=500M', 'find /tmp -delete', 'find / -exec rm {} +', 'snap remove x', 'git push', 'git branch new', 'git remote add x y', 'mount /dev/sdb1 /mnt', 'systemctl -p status restart cubefarm.service', 'systemctl --property status stop x', 'docker --config ps run alpine true', 'docker --context images rm keel-postgres', 'docker system --log-level df prune', 'snap --color list remove x', 'journalctl --cursor-file=/root/newfile -n 1', 'journalctl --cursor-fil=/root/x -n 1', 'journalctl --rot', 'journalctl --flu', 'journalctl --syn', 'journalctl --relinq', 'journalctl --update', 'journalctl --vacuum-s=500M', 'journalctl -u caddy --rot'])(
    'refuses a change and points to it_propose: %s',
    (line) => expect(refusedWhy(line)).toMatch(/it_propose/),
  );

  it('refuses programs off the list, paths to programs and git -c', () => {
    expect(refusedWhy('curl http://x')).toMatch(/isn't on the IT desk's read-only list/);
    expect(refusedWhy('/bin/rm -rf /tmp/x')).toMatch(/Name the program/);
    expect(refusedWhy('git -c core.pager=sh log')).toMatch(/git -c isn't allowed/);
    expect(refusedWhy('git log --output=/tmp/x')).toMatch(/isn't read-only/);
  });

  it.each(['ls /etc/keel', 'stat /etc/keel/gh.env', 'find /opt -name x.key', 'ls /opt/keel/.env', 'ls /root/.ssh/id_rsa', 'stat /opt/app/.env.local'])('never names a secret file: %s', (line) => {
    expect(refusedWhy(line)).toMatch(/holds secrets/);
  });

  it('lets ordinary files through', () => {
    expect(secretPath('/var/log/environment.log')).toBe(false);
    expect(secretPath('/opt/keel/keyboard.ts')).toBe(false);
  });
});

describe('neverRefusal (it_propose, and again at Run)', () => {
  it.each([
    ['pkill -f node', /name pattern/],
    ['killall node', /name pattern/],
    ['docker volume prune -f', /volume prune/],
    ['docker rm -f keel-postgres', /keel-postgres/],
    ['docker volume rm keel_postgres_data', /keel-postgres/],
    ['git push --force origin main', /force/],
    ['git push origin +main', /force/],
    ['rm -rf /', /removing \/ as a whole/],
    ['rm -rf /opt/', /removing \/opt as a whole/],
    ['rm -r ~', /removing \/root as a whole/],
    ['rm -rf /var/*', /removing \/var\/\* as a whole/],
    ['rm /etc/keel/gh.env', /secrets/],
    ['rm -rf /root/Projects/keelfarm/node_modules', /live office/],
    ['git -C /root/keelfarm reset --hard', /live office/],
    ['shutdown -h now', /rebooting/],
    ['systemctl reboot', /rebooting/],
    ['bash -c reboot', /runs other commands/],
    ['sudo rm -rf /tmp/x', /runs other commands/],
  ])('refuses %s', (line, why) => {
    const p = parseCommand(line);
    if ('refused' in p) throw new Error(p.refused);
    expect(neverRefusal(p.argv, office)).toMatch(why);
  });

  it.each(['rm -rf /var/cache/apt/archives', 'journalctl --vacuum-size=500M', 'docker image prune -af', 'systemctl restart caddy', 'snap remove --purge lxd', 'kill 4242', 'git push origin swarm/x'])('lets a change through: %s', (line) => {
    const p = parseCommand(line);
    if ('refused' in p) throw new Error(p.refused);
    expect(neverRefusal(p.argv, office)).toBeNull();
  });
});

describe('shapeOutput', () => {
  const mask = (s: string) => s.replace(/sk-ant-\w+/g, '***');

  it('sorts sizes biggest first and limits the lines', () => {
    expect(sortBySize(['12K\t/a', '3.4G\t/b', '512M\t/c', '1.1G\t/d'])).toEqual(['3.4G\t/b', '1.1G\t/d', '512M\t/c', '12K\t/a']);
    expect(shapeOutput({ out: '1K a\n9G b\n5M c\n', err: '', sort: 'size', lines: 2, mask })).toBe('9G b\n5M c\n… 1 more lines');
  });

  it('masks secrets and caps the size', () => {
    const out = shapeOutput({ out: `TOKEN=sk-ant-abc123\n${'x'.repeat(30_000)}`, err: 'du: cannot read', mask });
    expect(out).not.toContain('sk-ant-abc123');
    expect(out).toContain('TOKEN=***');
    expect(out.length).toBeLessThan(20_100);
    expect(out).toMatch(/cut at 20 KB/);
  });

  it('writes argv back as one line', () => expect(argvLine(['find', '/var', '-name', '*.gz', 'a b'])).toBe("find /var -name *.gz 'a b'"));
});
