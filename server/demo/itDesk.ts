// The demo's IT department (#506, #524): made-up output for the read-only commands, a pretend run for a change the
// manager taps Run on (the disk's free space grows with it), and a scripted IT lead (itSession) that answers in IT's
// chat through the real IT tools: "how much disk is free?" reads df; "free up space" reads du and journalctl, then puts
// two changes on cards; after a Run it checks df again and reports; a ticket (#542) gets an answer and a close; a health
// check gone bad gets a recommendation of three ranked clean-ups (#525); the weekly review proposes a fix (#543); "install
// clipfarm" walks a runbook's steps, which auto-approve runs without a tap when it's on (#585). The demo CEO hands "check the machine" to IT.
// Now and then a demo agent reports a lost lab result with it_report (withItReport).
import { describeOfficeTool, type LogEntry, type SessionCallbacks, type SessionHandle, type SessionOptions } from '../agentRunner.ts';
import { logStreamed, writeReply } from '../demoChat.ts';
import { registerCeoReply, registerDemo } from './registry.ts';
import { demoDiskRoom } from './disk.ts';

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

/** The monitoring's reads (#525): every listed unit running, none failed, last night's backup. */
function watchOut(argv: string[]): string | null {
  if (argv[0] === 'systemctl' && argv[1] === 'show') return argv.slice(argv.indexOf('Id,LoadState,ActiveState') + 1).map((u) => `Id=${u.includes('.') ? u : `${u}.service`}\nLoadState=loaded\nActiveState=active`).join('\n\n');
  if (argv[0] === 'systemctl' && argv[1] === 'list-units') return '';
  if (argv[0] === 'find') return `${(Date.now() - 10 * 3_600_000) / 1000} ${argv[1]}/2026-11-12\n${(Date.now() - 34 * 3_600_000) / 1000} ${argv[1]}/2026-11-11`;
  return null;
}

/** The clipfarm runbook's steps (#585): one card each, or done automatically with auto-approve on. */
const RUNBOOK: string[][] = [
  ['git', '-C', '/opt/clipfarm', 'pull', '--ff-only'],
  ['install', '-m', '0644', '/opt/clipfarm/deploy/clipfarm.service', '/etc/systemd/system/clipfarm.service'],
  ['systemctl', 'daemon-reload'],
  ['systemctl', 'enable', '--now', 'clipfarm.service'],
  ['install', '-m', '0644', '/opt/clipfarm/deploy/clipfarm.caddy', '/etc/caddy/sites/clipfarm.caddy'],
  ['caddy', 'validate', '--config', '/etc/caddy/Caddyfile'],
  ['caddy', 'reload', '--config', '/etc/caddy/Caddyfile'],
];
const RUNBOOK_OUT: Record<string, string> = {
  git: 'Updating 3f9c2a1..8b0d4e2\nFast-forward\n deploy/clipfarm.service | 4 ++--\n 1 file changed, 2 insertions(+), 2 deletions(-)',
  systemctl: 'Created symlink /etc/systemd/system/multi-user.target.wants/clipfarm.service → /etc/systemd/system/clipfarm.service.',
  caddy: 'Valid configuration',
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
      demoDiskRoom();
      return { code: 0, out: DONE[program]?.out ?? `(demo) ran ${argv.join(' ')}`, err: '' };
    }
    if (program === 'df') return { code: 0, out: df(), err: '' };
    if (argv.includes('rev-parse')) return { code: 0, out: '3f9c2a1b7d4e5f60718293a4b5c6d7e8f9012345\n', err: '' };
    if (RUNBOOK_OUT[program]) return { code: 0, out: RUNBOOK_OUT[program], err: '' };
    const watch = watchOut(argv);
    if (watch !== null) return { code: 0, out: watch, err: '' };
    return { code: 0, out: OUT[program] ?? `(demo) ${argv.join(' ')}: nothing to show in the demo`, err: '' };
  },
  certExpiry: async () => Date.now() + 61 * 24 * 3_600_000,
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
    // A ticket (#542): look, answer the reporters, close it.
    const ticket = p.match(/^Ticket #(\d+) \((\w[\w-]*)/m);
    if (ticket) {
      const id = Number(ticket[1]);
      const job = p.match(/\bjob ([\w-]+)/)?.[1];
      await use('it_health', {});
      const tell = ticket[2] === 'lab' ? `Run ${job ? `job ${job}` : 'it'} again once: the lab restarted and lost its result. lab_status shows your place.` : ticket[2] === 'ports' ? 'The port is free again: start your dev server and carry on.' : 'Checked on my side: carry on, and report again if it comes back.';
      await use('it_ticket', { id, tell, close: `Looked at the evidence; told the reporter: ${tell}`, cause: ticket[2] === 'lab' ? 'Test lab: lost result' : ticket[2] === 'ports' ? 'Port taken for my dev server' : 'Checked, nothing wrong', ...(ticket[2] === 'lab' && { code_fix: 'The lab drops a run\'s result when the office restarts mid-run: keep finished results for the agent.' }) });
      return `Ticket #${id}: answered the reporter and closed it.`;
    }
    // The weekly review (#543), or "what keeps going wrong?": the ranked causes, then a card for the top one not fixed.
    if (/The weekly review of IT's tickets|keeps going wrong/i.test(p)) {
      const brief = await use('it_review', { days: 28 });
      const top = brief.match(/\[(?:new|recurring)\] cause "([^"]+)" \(([^)]*)\): (\d+) tickets?[^,]*, (\d+) min, (\$[\d.]+)/);
      const floor = Number(brief.match(/^Floors: (\d+)/m)?.[1]);
      if (!top || !floor) return 'Nothing keeps going wrong: no open causes in the last four weeks.';
      const out = await use('it_improve', { proposals: [{ cause: top[1], kind: 'issue', floor, title: `Stop "${top[2]}" coming back`.slice(0, 120), why: `${top[3]} tickets, ${top[4]} agent-minutes, ${top[5]} wasted in four weeks.`, body: `What: "${top[2]}" keeps coming back (IT tickets).\nWhere: the office code that sets it up.\nAcceptance: no new ticket for it in two weeks; a test covers the case.` }] });
      return out.startsWith('Refused') ? `I couldn't put it on a card: ${out}` : `The costliest problem is "${top[2]}" (${top[3]} tickets, ${top[4]} min, ${top[5]}). A fix is on the card: approve it and I'll file it.`;
    }
    const ran = p.match(/The manager ran `([^`]+)`: (exit \d+|did not finish)/);
    const disk = rootDisk(await use('it_run', { command: 'df -h' }));
    const free = disk ? `${disk.avail} free of ${disk.size} (${disk.use} used)` : 'no reading from df';
    if (/The office's checks got worse/.test(p) && !/- Disk is/.test(p)) {
      const out = await use('it_recommend', {
        check: 'logs',
        title: 'System logs: 3.9 GB, over the 2 GB line',
        evidence: 'journalctl --disk-usage: 3.9 GB of archived and active journals.',
        options: [{ argv: ['journalctl', '--vacuum-size=500M'], does: 'Trim the system logs to 500 MB', frees: 'frees about 3.4 GB', risk: 'low', undo: "can't be undone: only archived logs go" }],
      });
      return out.startsWith('Refused') ? `I couldn't put the options on a card: ${out}` : 'The system logs have grown to 3.9 GB: one clean-up is on the card.';
    }
    if (/The office's checks got worse/.test(p)) {
      await use('it_run', { command: 'du -sh /var/lib/docker /var/log /root/.cache /opt/backups', sort: 'size' });
      const out = await use('it_recommend', {
        check: 'disk', // the demo's only check that goes wrong: Simulate low disk
        title: `Disk: ${p.match(/Disk is \w+: ([\d.]+ GB) free/)?.[1] ?? disk?.avail ?? 'little'} free, below the 10 GB reserve`,
        evidence: 'Docker holds 14 GB (8.9 GB unused images, 1.6 GB build cache); system logs 3.9 GB; /opt/backups 2.4 GB.',
        options: [
          { argv: ['docker', 'image', 'prune', '-af'], does: 'Remove unused Docker images', frees: 'frees about 8.9 GB', risk: 'low', undo: 'pulled again when a build needs them' },
          { argv: ['journalctl', '--vacuum-size=500M'], does: 'Trim the system logs to 500 MB', frees: 'frees about 3.4 GB', risk: 'low', undo: "can't be undone: only archived logs go" },
          { argv: ['docker', 'builder', 'prune', '-f'], does: "Clear Docker's build cache", frees: 'frees about 1.6 GB', risk: 'low', undo: 'rebuilt on the next build' },
        ],
      });
      return out.startsWith('Refused') ? `I couldn't put the options on a card: ${out}` : `The disk is low: ${free}. Three clean-ups are on the card, best first; pick one and I'll measure again.\n\`\`\`spoken\nThe disk is low. Pick a clean-up on the card.\n\`\`\``;
    }
    if (ran) return `Checked after \`${ran[1]}\` (${ran[2]}): the system disk now has **${free}**.\n\`\`\`spoken\nDone. The disk now has ${disk?.avail ?? 'more'} free.\n\`\`\``;
    if (/\binstall clipfarm\b/i.test(p)) {
      let auto = 0;
      for (const argv of RUNBOOK) {
        const out = await use('it_propose', { argv, why: "Floor 4 #20's runbook: install clipfarm", affects: 'clipfarm on this machine, behind Caddy', undo: 'disable the unit and remove its files', risk: 'low' });
        if (out.startsWith('Done automatically')) auto++;
      }
      return auto === RUNBOOK.length ? `clipfarm is installed: ${auto} steps done automatically, each with its output (and an Undo where there is one) in the chat.` : `The runbook is ${RUNBOOK.length} steps: ${auto ? `${auto} ran automatically, ` : ''}${RUNBOOK.length - auto} wait on cards for your Run. Turn on Auto-approve in the setup to let routine steps run by themselves.`;
    }
    if (/\b(gain|free up|clean|make room|recommend|what can go)\b|9\d%/i.test(p)) {
      await use('it_run', { command: 'du -sh /var/lib/docker /var/log /root/.cache /opt/backups /opt/keel', sort: 'size' });
      await use('it_run', { command: 'journalctl --disk-usage' });
      await use('it_propose', { argv: ['journalctl', '--vacuum-size=500M'], why: 'Old system logs take 3.9 GB; the last 500 MB is plenty.', affects: 'frees about 3.4 GB in /var/log/journal', undo: "can't be undone: only archived logs go", risk: 'low' });
      await use('it_propose', { argv: ['docker', 'image', 'prune', '-af'], why: 'Unused Docker images take 8.9 GB; keel-postgres and its volume stay.', affects: 'frees about 8.9 GB of images no container uses', undo: 'pulled again on the next build that needs them', risk: 'medium' });
      return `The system disk has ${free}. The biggest are Docker (14 GB, 8.9 GB of it unused images) and the system logs (3.9 GB). Two clean-ups are on cards: old logs (about 3.4 GB) and unused Docker images (about 8.9 GB). Tap Run, and I'll check the disk after.\n\`\`\`spoken\nI found about 12 gigabytes to free: tap Run on the cards when you are ready.\n\`\`\``;
    }
    if (/\b(disk|space|free)\b/i.test(p)) return `The system disk has **${free}**.\n\`\`\`suggestions\nFree up space\nCheck the machine\n\`\`\``;
    const health = await use('it_health', {});
    return `All quiet: the system disk has ${free}, and ${health.startsWith('Refused') ? "the office's readings aren't in yet" : "memory and the watchdog look fine"}.\n\`\`\`suggestions\nFree up space\nHow much disk is free?\nInstall clipfarm\n\`\`\``;
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

/** Now and then a demo build reports an office problem to IT (#542): every fifth issue's lab result goes missing. */
export function withItReport(opts: SessionOptions, cb: SessionCallbacks): SessionCallbacks {
  const issue = Number(opts.prompt.match(/#(\d+):/)?.[1] ?? 0);
  if (!opts.office?.defs.some((d) => d.name === 'it_report') || opts.task !== 'issue' || issue % 5) return cb;
  setTimeout(() => {
    const args = { what: 'Lab result lost', where: 'lab', evidence: `lab_run (npm test) for #${issue} never answered: job lab-${issue}`, blocking: true };
    cb.log([{ kind: 'tool', tool: 'mcp__office__it_report', text: `⏺ 🎫 it_report: ${args.what}` }]);
    void opts.office!.call('it_report', args).then((r) => cb.log([{ kind: 'result', text: `  ⎿ ${r.split('\n')[0].slice(0, 170)}` }]), () => undefined);
  }, 3000);
  return cb;
}
