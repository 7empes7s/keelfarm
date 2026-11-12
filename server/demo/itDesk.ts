// The demo's IT department (#506, #524): made-up output for the read-only commands, a pretend run for a change the
// manager taps Run on (the disk's free space grows with it), and a scripted IT lead (itSession) that answers in IT's
// chat through the real IT tools: "how much disk is free?" reads df; "free up space" reads du and journalctl, then puts
// two changes on cards; after a Run it checks df again and reports. The demo CEO hands "check the machine" to IT.
import { describeOfficeTool, type LogEntry, type SessionCallbacks, type SessionHandle, type SessionOptions } from '../agentRunner.ts';
import { logStreamed, writeReply } from '../demoChat.ts';
import { registerCeoReply, registerDemo } from './registry.ts';

/** GB the demo's pretend changes have freed, so df after a Run shows it. */
let freedGb = 0;
const df = () => {
  const used = Math.max(60, 112 - freedGb);
  return ['Filesystem      Size  Used Avail Use% Mounted on', `/dev/sda1       150G  ${Math.round(used)}G   ${Math.round(150 - 6 - used)}G  ${Math.round((used / 150) * 100)}% /`, 'tmpfs           3.8G     0  3.8G   0% /dev/shm', '/dev/sdb        100G  8.1G   92G   9% /mnt/work'].join('\n');
};

const OUT: Record<string, string> = {
  du: ['14G\t/var/lib/docker', '6.2G\t/var/log', '3.1G\t/root/.cache', '2.4G\t/opt/backups', '640M\t/opt/keel'].join('\n'),
  free: ['               total        used        free      shared  buff/cache   available', 'Mem:           7.6Gi       5.1Gi       410Mi       120Mi       2.1Gi       2.2Gi', 'Swap:          8.0Gi       1.3Gi       6.7Gi'].join('\n'),
  journalctl: 'Archived and active journals take up 3.9G in the file system.',
  docker: ['TYPE            TOTAL     ACTIVE    SIZE      RECLAIMABLE', 'Images          23        4         11.2GB    8.9GB (79%)', 'Containers      4         4         210MB     0B (0%)', 'Local Volumes   3         2         2.4GB     0B (0%)', 'Build Cache     41        0         1.6GB     1.6GB'].join('\n'),
  uptime: ' 18:02:11 up 12 days,  3:41,  1 user,  load average: 1.21, 0.98, 0.87',
};

/** What a demo change "did", and the GB it freed. */
const DONE: Record<string, { out: string; gb: number }> = {
  journalctl: { out: 'Vacuuming done, freed 3.4G of archived journals from /var/log/journal.', gb: 3.4 },
  docker: { out: 'Deleted Images:\nuntagged: node:20-old\n…\nTotal reclaimed space: 8.9GB', gb: 8.9 },
  apt: { out: 'Reading package lists... Done\n0 upgraded, 0 newly installed, 0 to remove.\nDel cached packages: 1.1 GB freed', gb: 1.1 },
};

registerDemo('itDesk', () => ({
  itExec: async (argv) => {
    await new Promise((r) => setTimeout(r, 120));
    const program = argv.find((a) => a === 'df' || a in OUT || a in DONE) ?? argv[0];
    const change = argv.some((a) => /^--vacuum|^prune$|^clean$|^autoremove$|^rm$/.test(a));
    if (change) {
      freedGb += DONE[program]?.gb ?? 0;
      return { code: 0, out: DONE[program]?.out ?? `(demo) ran ${argv.join(' ')}`, err: '' };
    }
    if (program === 'df') return { code: 0, out: df(), err: '' };
    return { code: 0, out: OUT[program] ?? `(demo) ${argv.join(' ')}: nothing to show in the demo`, err: '' };
  },
}));

/** The system disk's line of df -h: size, free and use%. */
function rootDisk(out: string) {
  const m = out.match(/^\S+\s+(\S+)\s+\S+\s+(\S+)\s+(\d+%)\s+\/$/m);
  return m ? { size: m[1], avail: m[2], use: m[3] } : null;
}

/** The demo's IT lead: a few real tool calls, then a short answer in IT's chat. */
export function itSession(opts: SessionOptions, cb: SessionCallbacks): SessionHandle {
  const office = opts.office!;
  const timers: NodeJS.Timeout[] = [];
  let stopped = false;
  let done = false;
  const wait = (ms: number) => new Promise<void>((resolve) => timers.push(setTimeout(resolve, ms)));
  const use = async (name: string, args: Record<string, unknown>) => {
    if (stopped) throw new Error('Stopped by manager');
    const entries: LogEntry[] = [{ kind: 'tool', tool: `mcp__office__${name}`, text: `⏺ ${describeOfficeTool(name, args)}` }];
    cb.tool(entries[0].tool!);
    logStreamed(entries, opts, cb);
    await wait(200);
    const out = await office.call(name, args);
    cb.log([{ kind: out.startsWith('Refused') ? 'error' : 'result', text: `  ⎿ ${out.split('\n')[0].slice(0, 170)}` }]);
    return out;
  };
  const run = async (): Promise<string> => {
    const p = opts.prompt;
    const ran = p.match(/The manager ran `([^`]+)`: (exit \d+|did not finish)/);
    const disk = rootDisk(await use('it_run', { command: 'df -h' }));
    const free = disk ? `${disk.avail} free of ${disk.size} (${disk.use} used)` : 'no reading from df';
    if (ran) return `Checked after \`${ran[1]}\` (${ran[2]}): the system disk now has **${free}**.\n\`\`\`spoken\nDone. The disk now has ${disk?.avail ?? 'more'} free.\n\`\`\``;
    if (/\b(gain|free up|clean|make room|recommend|what can go)\b|9\d%/i.test(p)) {
      await use('it_run', { command: 'du -sh /var/lib/docker /var/log /root/.cache /opt/backups /opt/keel', sort: 'size' });
      await use('it_run', { command: 'journalctl --disk-usage' });
      await use('it_propose', { argv: ['journalctl', '--vacuum-size=500M'], why: 'Old system logs take 3.9 GB; the last 500 MB is plenty.', affects: 'frees about 3.4 GB in /var/log/journal', undo: "can't be undone: only archived logs go", risk: 'low' });
      await use('it_propose', { argv: ['docker', 'image', 'prune', '-af'], why: 'Unused Docker images take 8.9 GB; keel-postgres and its volume stay.', affects: 'frees about 8.9 GB of images no container uses', undo: 'pulled again on the next build that needs them', risk: 'medium' });
      return `The system disk has ${free}. The biggest are Docker (14 GB, 8.9 GB of it unused images) and the system logs (3.9 GB). Two clean-ups are on cards: old logs (about 3.4 GB) and unused Docker images (about 8.9 GB). Tap Run, and I'll check the disk after.\n\`\`\`spoken\nI found about 12 gigabytes to free: tap Run on the cards when you are ready.\n\`\`\``;
    }
    if (/\b(disk|space|free)\b/i.test(p)) return `The system disk has **${free}**.\n\`\`\`suggestions\nFree up space\nCheck the machine\n\`\`\``;
    const health = await use('it_health', {});
    return `All quiet: the system disk has ${free}, and ${health.startsWith('Refused') ? "the office's readings aren't in yet" : "memory and the watchdog look fine"}.\n\`\`\`suggestions\nFree up space\nHow much disk is free?\n\`\`\``;
  };
  const finish = (ok: boolean, text: string, error?: string) => {
    if (done) return;
    done = true;
    cb.tool(null);
    cb.finished({ ok, text, costUsd: ok ? 0.03 : 0.01, turns: 3, errors: error ? [error] : [] });
  };
  const go = async () => {
    try {
      cb.log([{ kind: 'system', text: `✻ Claude Code (demo) · ${opts.model} · ${opts.effort} effort · IT` }]);
      cb.sessionId(opts.resumeSessionId ?? `demo-it-${Date.now().toString(36)}`);
      const reply = await run();
      await writeReply(reply, opts, cb, () => stopped);
      finish(true, reply);
    } catch (err) {
      finish(false, '', stopped ? 'Stopped by manager' : (err as Error).message);
    }
  };
  timers.push(setTimeout(() => void go(), 200));
  return {
    send(text) {
      timers.push(setTimeout(() => !stopped && !done && cb.turn?.(`Noted: "${text.split('\n').at(-1)?.slice(0, 90)}". I'll take it into account.`), 600));
    },
    stop() {
      stopped = true;
      timers.forEach(clearTimeout);
      finish(false, '', 'Stopped by manager');
    },
  };
}

registerCeoReply('it desk', async ({ text, use }) => {
  if (!/\b(gain|free up|free)\b.*\bspace\b|\bcheck (the|this) machine\b|\bit desk\b/i.test(text)) return null;
  const out = await use('ask_it', { question: text });
  if (out.startsWith('Refused')) return `I can't hand that to IT right now: ${out.replace(/^Refused:\s*/, '')}`;
  return `That's the IT department's: I've asked them in the IT chat. They'll look, and any change comes to you on a card with Run / Not now.\n\`\`\`spoken\nI've passed that to IT. Their answer is in the IT chat.\n\`\`\``;
}, { early: true });
