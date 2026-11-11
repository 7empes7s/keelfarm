// The demo's IT desk (#506): made-up output for the read-only commands, and a pretend run for a change the manager
// taps Run on. The demo CEO shows both tools on "where can I gain space?" or "check the machine": two reads, then two
// changes on cards.
import { registerCeoReply, registerDemo } from './registry.ts';

const OUT: Record<string, string> = {
  df: ['Filesystem      Size  Used Avail Use% Mounted on', '/dev/sda1       150G  112G   32G  78% /', 'tmpfs           3.8G     0  3.8G   0% /dev/shm', '/dev/sdb        100G  8.1G   92G   9% /mnt/work'].join('\n'),
  du: ['14G\t/var/lib/docker', '6.2G\t/var/log', '3.1G\t/root/.cache', '2.4G\t/opt/backups', '640M\t/opt/keel'].join('\n'),
  free: ['               total        used        free      shared  buff/cache   available', 'Mem:           7.6Gi       5.1Gi       410Mi       120Mi       2.1Gi       2.2Gi', 'Swap:          8.0Gi       1.3Gi       6.7Gi'].join('\n'),
  journalctl: 'Archived and active journals take up 3.9G in the file system.',
  docker: ['TYPE            TOTAL     ACTIVE    SIZE      RECLAIMABLE', 'Images          23        4         11.2GB    8.9GB (79%)', 'Containers      4         4         210MB     0B (0%)', 'Local Volumes   3         2         2.4GB     0B (0%)', 'Build Cache     41        0         1.6GB     1.6GB'].join('\n'),
  uptime: ' 18:02:11 up 12 days,  3:41,  1 user,  load average: 1.21, 0.98, 0.87',
};

/** What a demo change "did". */
const DONE: Record<string, string> = {
  journalctl: 'Vacuuming done, freed 3.4G of archived journals from /var/log/journal.',
  docker: 'Deleted Images:\nuntagged: node:20-old\n…\nTotal reclaimed space: 8.9GB',
  apt: 'Reading package lists... Done\n0 upgraded, 0 newly installed, 0 to remove.\nDel cached packages: 1.1 GB freed',
};

registerDemo('itDesk', () => ({
  itExec: async (argv) => {
    await new Promise((r) => setTimeout(r, 300));
    const program = argv.find((a) => a in OUT || a in DONE) ?? argv[0];
    const change = argv.some((a) => /^--vacuum|^prune$|^clean$|^autoremove$|^rm$/.test(a));
    if (change) return { code: 0, out: DONE[program] ?? `(demo) ran ${argv.join(' ')}`, err: '' };
    return { code: 0, out: OUT[program] ?? `(demo) ${argv.join(' ')}: nothing to show in the demo`, err: '' };
  },
}));

registerCeoReply('it desk', async ({ text, use }) => {
  if (!/\b(gain|free up|free)\b.*\bspace\b|\bcheck (the|this) machine\b|\bit desk\b/i.test(text)) return null;
  const df = await use('it_run', { command: 'df -h' });
  if (df.startsWith('Refused')) return `I can't look at the machine right now: ${df.replace(/^Refused:\s*/, '')}`;
  await use('it_run', { command: 'du -sh /var/lib/docker /var/log /root/.cache /opt/backups /opt/keel', sort: 'size' });
  await use('it_run', { command: 'journalctl --disk-usage' });
  await use('it_propose', { argv: ['journalctl', '--vacuum-size=500M'], why: 'Old system logs take 3.9 GB; the last 500 MB is plenty.', affects: 'frees about 3.4 GB in /var/log/journal', undo: "can't be undone: only archived logs go", risk: 'low' });
  await use('it_propose', { argv: ['docker', 'image', 'prune', '-af'], why: 'Unused Docker images take 8.9 GB; keel-postgres and its volume stay.', affects: 'frees about 8.9 GB of images no container uses', undo: 'pulled again on the next build that needs them', risk: 'medium' });
  return 'The system disk is 78% full (32 GB free). The biggest are Docker (14 GB, 8.9 GB of it unused images) and the system logs (3.9 GB). I put two clean-ups on cards for you: old logs (about 3.4 GB) and unused Docker images (about 8.9 GB). Tap Run on each, or Run all.\n```spoken\nThe disk is 78% full. I found about 12 gigabytes to free in old logs and unused Docker images: tap Run on the cards when you are ready.\n```';
}, { early: true });
