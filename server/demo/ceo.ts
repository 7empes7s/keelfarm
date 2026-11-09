// The demo CEO (#257): a scripted CEO that works through the real office tools: onboarding, plans, research, reviews,
// triage, follow-ups and chat replies (features add theirs with registerCeoReply).
import type { LogEntry, SessionCallbacks, SessionHandle, SessionOptions } from '../agentRunner.ts';
import { describeOfficeTool } from '../agentRunner.ts';
import { demoAwake, demoRound } from '../demoAwake.ts';
import { logStreamed, writeReply } from '../demoChat.ts';
import { demoDraft } from '../demoCharters.ts';
import { demoResolve } from '../demoDecisions.ts';
import { demoMakeFiles, sentFiles, wantsFile } from '../demoFiles.ts';
import { demoCeoAnswer } from '../demoPrompts.ts';
import { demoReactions } from '../demoReactions.ts';
import { demoRefsLine } from '../demoReads.ts';
import { researchBrief } from '../demoResearch.ts';
import { parseForwarded } from '../../shared/chat.ts';
import { parseCeoMessage } from '../../shared/chatParts.ts';
import { briefSpeech, spokenLine } from '../../shared/speech.ts';
import { ceoReply } from './registry.ts';

interface Profile {
  summary: string;
  qa: string;
  playbook: string;
}

const PROFILES: Record<string, Profile> = {
  'pixel-todo': {
    summary: 'Todo web app · React + Vite + TypeScript',
    qa: '- Add, complete, edit and delete todos; they survive a reload\n- Keyboard only: every action reachable, focus always visible\n- Phone width (375px): nothing overflows or gets cut off\n- No errors in the browser console',
    playbook:
      '## Map\n- src/components/: React views, no storage calls\n- src/store/: todo state and localStorage; components use its hooks only\n- area theme: src/App.tsx, src/styles.css\n## Conventions\n- One component per file, tests next to it (*.test.tsx)\n## Skills\n- frontend-design for UI, test-driven-development for store changes\n## Traps\n- localStorage throws in private windows: wrap reads and writes',
  },
  'weather-api': {
    summary: 'REST API · Node + Express',
    qa: '- Every endpoint: happy path, bad input (400), unknown city (404)\n- Response shapes match the OpenAPI document\n- Rate limiting returns 429 with Retry-After\n- Tests and lint pass',
    playbook:
      '## Map\n- src/routes/: HTTP only, they call src/services/\n- src/services/: the logic, never imports express\n## Conventions\n- Update openapi.yaml with every endpoint change\n## Skills\n- test-driven-development for services\n## Traps\n- The upstream weather client is rate limited: mock it in tests',
  },
};

const GENERIC: Profile = {
  summary: 'Web project · early stage',
  qa: '- The app builds and starts\n- The changed feature works end to end in the browser\n- Phone width: nothing overflows\n- No console errors',
  playbook: '## Conventions\n- Small modules, tests next to the code\n## Skills\n- frontend-design for UI work',
};

/** Real CEOs end with a ```spoken summary (#282); a demo reply without its own says its first sentence or two. */
export function withSpoken(reply: string): string {
  if (/^```spoken\s*$/m.test(reply)) return reply;
  const said = spokenLine(briefSpeech(parseCeoMessage(reply).text, 2));
  return said ? `${reply}\n\n\`\`\`spoken\n${said}\n\`\`\`` : reply;
}

/** The demo CEO's answer to a reply: the quote it answers, then a word on the answer. */
export function answerReply({ quote, reply }: { quote: string; reply: string }): string {
  const q = quote.length > 140 ? `${quote.slice(0, 139).trim()}…` : quote;
  const said = reply.length > 90 ? `${reply.slice(0, 89).trim()}…` : reply;
  if (/\bplan\b/i.test(said))
    return `> ${q}\n\nHere it is.\n\n\`\`\`artifact title="The plan"\n## Next milestone\n\n1. Finish the issues in progress\n2. Merge what passed QA\n3. Plan the next features with you\n\n| Step | Who | When |\n| --- | --- | --- |\n| Build | the team | today |\n| QA | the team | as PRs land |\n| Merge | the office | once checks pass |\n\`\`\`\n\n(I'm the demo CEO, so nothing changes.)`;
  const answer = /^(yes|yep|sure|ok(ay)?|go)\b/i.test(said) ? "Great, I'll go ahead with that." : /^(no|nope|don't|stop)\b/i.test(said) ? "Understood, I'll leave it as it is." : `Noted: "${said}".`;
  return `> ${q}\n\n${answer} (I'm the demo CEO, so nothing changes, but the real one would act on it.)`;
}

/** The demo CEO's answer to "where did the money go?": a dashboard of live sources, so it shows the demo's own costs. */
export function demoMoneyAnswer(): string {
  const dashboard = {
    title: 'This week’s spend',
    tiles: [
      { label: 'Spend', source: 'costs:7d:total' },
      { label: 'Per merge', source: 'costs:7d:costPerMerge' },
      { label: 'Waste', source: 'costs:7d:waste' },
      { label: 'Merges', source: 'costs:7d:merges' },
    ],
    charts: [
      { type: 'bar', title: 'By floor', source: 'costs:7d:byFloor' },
      { type: 'donut', title: 'By kind of work', source: 'costs:7d:byKind' },
    ],
  };
  const trend = { type: 'line', title: 'Cost per merge, day by day', source: 'costs:7d:perMerge' };
  const waste = { title: 'Waste by cause', columns: ['Cause'], source: 'costs:7d:wasteByCause' };
  return ["Here's where this week's money went: by floor, by kind of work, the waste and the cost per merge. Tap a floor to open it.", '', '```dashboard', JSON.stringify(dashboard), '```', '', '```chart', JSON.stringify(trend), '```', '', '```table', JSON.stringify(waste), '```'].join('\n');
}

/** The demo CEO's answer to "how much of the server is used?" (#271): the server's live sources, so it shows the demo's own. */
export function demoServerAnswer(): string {
  const previews = { type: 'bar', title: 'Memory by preview', unit: 'mb', source: 'server:previews' };
  return ["Here's the server now: memory, swap, load and disk, what uses the memory and the last 24 hours. Tap an agent to open them.", '', '```dashboard', JSON.stringify({ title: 'The server', source: 'server' }), '```', '', '```chart', JSON.stringify(previews), '```'].join('\n');
}

/** A floor in company_status (compact, #329), as far as the demo CEO reads it. */
export interface DemoFloor {
  floor: number;
  repo: string;
  description: string;
  team: { size: number; max: number; free: number; pendingHires: number; pendingLetGos: number };
  capacity: { issuesReadyToStart: number; prsAwaitingQa: number };
  backlogCounts: { open: number };
  backlog: { number: number; title: string }[]; // in progress, waiting, then the first ready ones
  pullRequests: { number: number }[];
  agents?: { name: string }[];
}

/** floor_detail, as far as the demo CEO reads it: the charter's compact rendering (shared/charter.ts) and the office playbook. */
export interface DemoDetail {
  charter: string | null;
  officePlaybook: string | null;
}

export interface DemoStatus {
  company: { scaling: string }; // how team changes go, in words ("team changes apply straight away")
  floors: DemoFloor[];
  pendingChanges: unknown[];
  openDecisions?: { id: string; question: string }[];
}

/** The objective ids in a floor's charter, in order. */
export const objectiveIds = (charter: string | null) => [...(charter ?? '').matchAll(/^- (O\d{1,2}):/gm)].map((m) => m[1]);

/** The team a floor will have once the changes waiting for the manager are decided. */
export const plannedSize = (t: DemoFloor['team']) => t.size + t.pendingHires - t.pendingLetGos;
export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
export const short = (s: string, n = 48) => (s.length > n ? `${s.slice(0, n - 1).trim()}…` : s);
/** An office tool's refusal, without its "Refused: ". */
export const refused = (out: string) => out.replace(/^Refused: /, '');

/** The demo CEO grows a floor up to this many agents on its own (the real CEO's "rarely more than 4 to 6"). */
const DEMO_GROW_TO = 6;

/**
 * The demo CEO's call to grow a floor: when the issues ready to start (`ready`) outnumber its free agents and the
 * agents already on their way, up to DEMO_GROW_TO and the floor's max. Null: the team can keep up.
 */
export function demoGrow(f: DemoFloor, ready: number): { size: number; reason: string } | null {
  const now = plannedSize(f.team);
  const waiting = ready - f.team.free - f.team.pendingHires;
  const size = Math.min(f.team.max, Math.max(now, DEMO_GROW_TO), now + waiting);
  if (waiting <= 0 || size <= now) return null;
  return {
    size,
    reason: `${plural(ready, 'issue')} ${ready === 1 ? 'is' : 'are'} ready to start on floor ${f.floor} and ${plural(f.team.free, 'agent')} ${f.team.free === 1 ? 'is' : 'are'} free: with ${size} agents they're worked on side by side instead of waiting.`,
  };
}

/** The demo CEO's call to shrink a floor: several agents idle with nothing ready to start or test. Never below one. */
export function demoShrink(f: DemoFloor): { size: number; reason: string } | null {
  const now = plannedSize(f.team);
  const idle = f.team.free - f.team.pendingLetGos;
  if (idle < 2 || f.capacity.issuesReadyToStart > 0 || f.capacity.prsAwaitingQa > 0) return null;
  const size = Math.max(1, now - (idle - 1));
  if (size >= now) return null;
  return { size, reason: `${idle} of ${f.team.size} agents on floor ${f.floor} are idle with nothing ready to start or test; ${size} can keep up with what comes in.` };
}

/** A scripted CEO that uses the real office tools, so team changes, profiles and issues behave exactly as in the real thing. */
export function ceoSession(opts: SessionOptions, cb: SessionCallbacks): SessionHandle {
  const office = opts.office!;
  const timers: NodeJS.Timeout[] = [];
  let stopped = false;
  let done = false;
  const wait = (ms: number) => new Promise<void>((resolve) => timers.push(setTimeout(resolve, ms)));
  const step = async (entries: LogEntry[], ms = 900 + Math.random() * 1500) => {
    if (stopped) throw new Error('Stopped by manager');
    cb.tool(entries.find((e) => e.tool)?.tool ?? null);
    logStreamed(entries, opts, cb);
    await wait(ms);
  };
  const status = async () => {
    await step([{ kind: 'tool', tool: 'mcp__office__company_status', text: `⏺ ${describeOfficeTool('company_status', {})}` }]);
    const s = JSON.parse(await office.call('company_status', {})) as DemoStatus;
    const agents = s.floors.reduce((n, f) => n + f.team.size, 0);
    const free = s.floors.reduce((n, f) => n + f.team.free, 0);
    const issues = s.floors.reduce((n, f) => n + f.backlogCounts.open, 0);
    cb.log([{ kind: 'result', text: `  ⎿ ${s.floors.length} floors · ${agents} agents · ${free} free · ${issues} open issues · ${s.pendingChanges.length} team changes pending` }]);
    return s;
  };
  const use = async (name: string, args: Record<string, unknown>) => {
    await step([{ kind: 'tool', tool: `mcp__office__${name}`, text: `⏺ ${describeOfficeTool(name, args)}` }]);
    const out = await office.call(name, args);
    cb.log([{ kind: out.startsWith('Refused') ? 'error' : 'result', text: `  ⎿ ${out.split('\n')[0].slice(0, 170)}` }]);
    return out;
  };
  /** floor_detail: what the compact company_status leaves out, read before charters, playbooks and planned issues. */
  const detail = async (floor: number): Promise<DemoDetail> => {
    const out = await use('floor_detail', { floor });
    return out.startsWith('Refused') ? { charter: null, officePlaybook: null } : (JSON.parse(out) as DemoDetail);
  };
  const read = (file: string, lines: number) => step([{ kind: 'tool', tool: 'Read', text: `⏺ Read ${file}` }, { kind: 'result', text: `  ⎿ Read ${lines} lines` }]);
  const think = (text: string) => step([{ kind: 'thinking', text: '✻ Thinking…' }, { kind: 'text', text: `● ${text}` }], 1800);
  /** What happens next, by Settings → Team changes; `added`: new agents (negative: agents leaving). */
  const after = (s: DemoStatus, added: number) => {
    const who = added === 1 ? 'The new agent' : 'The new agents';
    if (/auto|straight away/i.test(s.company.scaling)) return added > 0 ? `${who} ${added === 1 ? 'is' : 'are'} on the way up.` : 'Idle agents leave first; anyone busy finishes their task.';
    return added > 0 ? `${who} ${added === 1 ? 'waits' : 'wait'} in the lobby for you to set up and hire.` : "It's an envelope on the desk of whoever I picked to leave, waiting for your decision.";
  };
  /** scale_team with the call made, and a sentence on how it went. */
  const scale = async (s: DemoStatus, f: DemoFloor, call: { size: number; reason: string }) => {
    const out = await use('scale_team', { floor: f.floor, ...call });
    return out.startsWith('Refused')
      ? `I wanted floor ${f.floor} at ${plural(call.size, 'agent')}, but the office said no: ${refused(out)}`
      : `Floor ${f.floor} goes from ${f.team.size} to ${plural(call.size, 'agent')}: ${call.reason} ${after(s, call.size - plannedSize(f.team))}`;
  };

  /** Files the brief's first three issues, each naming an objective when the charter has some; returns the skeleton's number. */
  const planIssues = async (floor: number, mission: string, ids: string[]) => {
    const tag = (i: number) => (ids.length ? `\n\nObjective: ${ids[Math.min(i, ids.length - 1)]}` : '');
    const first = await use('file_issue', {
      floor,
      title: 'Set up the project skeleton',
      body: `Scaffold the app so the rest of the milestone has something to build on.\n\nBrief: ${mission}\n\nAcceptance criteria:\n- The dev server starts\n- A placeholder home page renders\n- Lint, tests and build scripts exist${tag(0)}`,
    });
    const n = Number(first.match(/#(\d+)/)?.[1] ?? 0);
    await use('file_issue', {
      floor,
      title: `Build the core: ${short(mission, 60)}`,
      body: `${n ? `Depends on #${n}\n\n` : ''}Implement the heart of the brief.\n\nAcceptance criteria:\n- The main flow works end to end\n- Covered by tests${tag(0)}`,
    });
    await use('file_issue', {
      floor,
      title: 'Polish: phone layout and empty states',
      body: `${n ? `Depends on #${n}\n\n` : ''}Make every screen work at 375px and add friendly empty states.${tag(1)}`,
    });
    return n;
  };

  const scripts = {
    async onboard(floor: number, fullName: string) {
      const s = await status();
      const f = s.floors.find((x) => x.floor === floor);
      if (!f) return 'That floor has gone, so there was nothing to onboard.';
      const p = PROFILES[fullName.split('/')[1] ?? ''] ?? GENERIC;
      await read(`${f.repo}/README.md`, 48);
      await step([{ kind: 'tool', tool: 'Glob', text: '⏺ Glob src/**/*' }, { kind: 'result', text: '  ⎿ Found 23 files' }]);
      await read('package.json', 36);
      await think(`${p.summary}. Let me size the team for the work in sight.`);
      await use('set_floor_profile', { floor, summary: p.summary, qa_brief: p.qa, playbook: p.playbook });
      const ready = f.capacity.issuesReadyToStart;
      const grow = demoGrow(f, ready);
      const team = grow ? await scale(s, f, grow) : `Its ${plural(f.team.size, 'agent')} can keep up with the ${plural(ready, 'issue')} ready to start.`;
      const drafted = (await detail(floor)).charter ? '' : await use('propose_charter', { floor, ...demoDraft(f.description || p.summary, p.qa) });
      const charter = drafted && !drafted.startsWith('Refused') ? 'I drafted a charter for it: approve or edit it in the Charter tab.' : '';
      const next = f.backlogCounts.open === 0 ? ' The backlog is empty: tell me what you would like built and I will plan it.' : '';
      return [`Floor ${floor}: ${p.summary}. I wrote a QA brief and a playbook for it.`, team, charter, next].filter(Boolean).join(' ');
    },
    async plan(floor: number, mission: string) {
      const s = await status();
      const f = s.floors.find((x) => x.floor === floor);
      if (!f) return 'That floor has gone, so there was nothing to plan.';
      await read(`${f.repo}/README.md`, 12);
      await think("Foundation first, so the parallel work doesn't collide.");
      const n = await planIssues(floor, mission, objectiveIds((await detail(floor)).charter));
      const grow = demoGrow(f, f.capacity.issuesReadyToStart + (n ? 1 : 0));
      const team = grow ? ` ${await scale(s, f, grow)}` : '';
      return `I turned the brief into three issues on floor ${floor}. #${n} sets up the skeleton; the other two say "Depends on #${n}", so nobody starts them early.${team}`;
    },
    // Research: look outward and inward, then bring options with sources, filing nothing (server/research.ts).
    async research(topic: string, floor: number | null) {
      const s = await status();
      const f = s.floors.find((x) => x.floor === floor) ?? s.floors[0];
      await step([{ kind: 'tool', tool: 'WebSearch', text: `⏺ Web Search("${short(topic, 60)} best practices")` }, { kind: 'result', text: '  ⎿ Did 1 search' }]);
      await step([{ kind: 'tool', tool: 'WebFetch', text: '⏺ Fetch(https://developer.mozilla.org/en-US/docs/Web)' }, { kind: 'result', text: '  ⎿ Received 48.2KB' }]);
      if (f) await read(`${f.repo}/README.md`, 40);
      await think('Three distinct ways to do it. Facts and guesses kept apart.');
      return researchBrief(topic, f ? `floor ${f.floor} (\`${f.repo.split('/').pop()}\`)` : 'your floors');
    },
    async review() {
      const s = await status();
      await think('Checking each floor for work waiting on free agents, and agents waiting on work.');
      for (const f of s.floors) {
        const call = demoShrink(f) ?? demoGrow(f, f.capacity.issuesReadyToStart);
        if (call) return scale(s, f, call);
      }
      const issues = s.floors.reduce((n, f) => n + f.backlogCounts.open, 0);
      const prs = s.floors.reduce((n, f) => n + f.pullRequests.length, 0);
      return `All ${s.floors.length} floors look healthy: ${issues} open issues and ${prs} pull requests in flight. No changes needed.`;
    },
    // A stuck PR: read what QA and GitHub say, then act through the real triage tools, as the real CEO would.
    async triage(floor: number, pr: number, facts: string) {
      await step([{ kind: 'tool', tool: 'Read', text: `⏺ Read PR #${pr}'s QA report` }, { kind: 'result', text: '  ⎿ Read 38 lines' }]);
      const conflict = /mergeable: CONFLICTING/.test(facts);
      const red = /GitHub checks: failing/.test(facts);
      const again = !/triage 1 of/.test(facts);
      await think(conflict ? 'It only conflicts with main; the change itself is fine.' : red ? 'A red check that looks like a flake.' : again ? 'Stuck a second time. This needs a call from the manager.' : 'The fix sessions stalled, not the code. Another QA round should settle it.');
      const [tool, args, done] = conflict
        ? ['send_back', { note: 'Merge main and keep both changes working; QA already liked the rest.' }, 'went back for a fix: merging main']
        : red
          ? ['rerun_checks', {}, 'had its failed checks re-run']
          : again
            ? ['escalate', { reason: 'It got stuck twice for the same reason; worth a look at the issue itself.' }, 'is with you now']
            : ['retry_qa', {}, 'is back in the QA queue'];
      const out = await use(tool, { floor, pr, ...args });
      if (!out.startsWith('Refused')) return `PR #${pr} on floor ${floor} was stuck. It ${done}.`;
      await use('escalate', { floor, pr, reason: `I tried ${tool}, but the office refused: ${refused(out)}` });
      return `PR #${pr} on floor ${floor} is stuck and I couldn't move it, so it's with you now.`;
    },
    // Woken by office events: look through the real read-only tools, and stay quiet unless something needs the manager.
    async followup(events: string[]) {
      const needs: string[] = [];
      for (const e of events.slice(0, 4)) {
        const floor = Number(e.match(/floor (\d+)/)?.[1] ?? 0);
        const pr = Number(e.match(/PR #(\d+)/)?.[1] ?? 0);
        const agent = e.match(/\(([\w-]+)\)/)?.[1];
        if (/ merged /.test(e) && pr) await use('pr_diff', { floor, pr });
        else if (/failed QA/.test(e) && pr) await use('qa_report', { floor, pr });
        else if (agent && / error | stalled /.test(e)) {
          await use('agent_log', { agent_id: agent, lines: 50 });
          if (/ error /.test(e) && (await use('restart_agent', { agent_id: agent })).startsWith('Refused')) needs.push(`${e.split(' (')[0]} is still in an error and I couldn't restart them; reset them from their desk.`);
        } else if (!(await demoCeoAnswer(e, use, think))) await think('Nothing there needs me.'); // an agent's question: answered, or on the manager's phone
      }
      if (events.some((e) => / merged /.test(e))) await think('The merged changes match their issues.');
      return needs.length ? needs.join(' ') : 'Nothing to do.';
    },
    // The manager's changes touched running work (#207): a closed issue stops its builder, a closed PR's author is told to wrap up, the rest finish.
    async changes(lines: string[]) {
      const out: string[] = [];
      for (const l of lines) {
        const floor = Number(l.match(/^- floor (\d+)/)?.[1] ?? 0);
        for (const [, name, id, state] of (l.split(' · touched: ')[1] ?? '').matchAll(/([^,(]+?) \(([\w-]+), ([^)]*)\)/g)) {
          const who = name.trim();
          if (state === 'finished it already') {
            out.push(`${who} had already finished, so there was nothing to stop.`);
            continue;
          }
          await use('agent_log', { agent_id: id, lines: 30 });
          const stop = /: closed #/.test(l) ? await use('stop_agent', { agent_id: id, reason: 'you closed their issue' }) : '';
          if (/isn't running/.test(stop)) out.push(`${who} had already finished, so there was nothing to stop.`);
          else if (stop && !stop.startsWith('Refused')) out.push(`Stopped ${who}: you closed their issue.`);
          else if (/: closed PR/.test(l) && !(await use('message_agent', { floor, agent_id: id, text: 'The manager closed your PR: push nothing more, wrap up and say what is left.' })).startsWith('Refused')) out.push(`Redirected ${who}: they wrap up, since you closed their PR.`);
          else out.push(`Let ${who} finish: your change doesn't undo their work.`);
        }
      }
      return out.join('\n') || 'Nothing to do: that work had already ended.';
    },
    async chat(text: string) {
      const s = await status();
      await think('Reading your message.');
      const quick = await demoReactions(text, use); // several messages at once, "ok thanks", "go ahead" (#118)
      if (quick !== null) return quick;
      const kit = { text, s, use, detail, scale: (f: DemoFloor, call: { size: number; reason: string }) => scale(s, f, call) };
      const early = await ceoReply(kit, true); // "assign #3 to Ada" (#265): a command, even with the seeded chat's attachment
      if (early !== null) return early;
      const sent = sentFiles(opts.prompt); // files from the manager, or a document asked for: the demo makes one
      if (sent.length || wantsFile(text)) return demoMakeFiles({ step, read, use, cwd: opts.cwd }, s.floors, sent);
      // A reply to one of the CEO's messages: answer it, quoting what it answers.
      const reply = parseForwarded(text);
      if (reply) return answerReply(reply);
      const awake = await demoAwake(text, s.floors, use); // "wait for PR #3", "consult …", "ask me …" (#28)
      const round = awake || (await demoRound(text, s.floors, use, async (tool, line, out, error) => (await step([{ kind: 'tool', tool, text: `⏺ ${line}` }], 3500), step([{ kind: error ? 'error' : 'result', text: `  ⎿ ${out}` }], 300)), async (floor) => objectiveIds((await detail(floor)).charter)[0])); // "look into …": the step log, long enough to hear two progress windows (#150, #286)
      if (round) return round;
      const resolved = await demoResolve(text, s.openDecisions, use); // an open decision answered in words (#114)
      if (resolved) return resolved;
      // The replies that show features' CEO tools (ceoReplies.ts, and any feature's own module): the first that answers.
      const registered = await ceoReply(kit);
      if (registered !== null) return registered;
      const agents = s.floors.reduce((n, f) => n + f.team.size, 0);
      const issues = s.floors.reduce((n, f) => n + f.backlogCounts.open, 0);
      const nextFloor = s.floors.find((f) => f.backlog.length);
      const next = nextFloor && { floor: nextFloor.floor, issue: nextFloor.backlog[0] };
      const pending = s.pendingChanges.length;
      // Real CEOs answer in Markdown, so the demo one does too: every element the phone renders, the longer part as an
      // artifact card and the question with suggestion boxes (shared/chatParts.ts).
      const rows = s.floors.map((f) => `| ${f.floor} | \`${f.repo.split('/').pop()}\` | ${f.team.size} | ${f.backlogCounts.open} | ${f.pullRequests.length} | ${f.capacity.issuesReadyToStart} | ${f.capacity.prsAwaitingQa} | ${f.team.free} |`);
      return [
        `**Quick status:** ${s.floors.length} floor${s.floors.length === 1 ? '' : 's'}, ${agents} agents and ${issues} open issues. The floor-by-floor report is attached.`,
        '',
        '- The team is *heads down* on the backlog',
        `- ${pending ? `**${pending}** team change${pending === 1 ? ' is' : 's are'} waiting for your decision` : 'No team changes waiting on you'}`,
        '  - QA re-tests every PR after a fix',
        '',
        '```artifact title="Floor report"',
        '## Every floor',
        '',
        '| Floor | Repo | Agents | Issues | PRs | Ready to start | Waiting for QA | Free agents |',
        '| ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: |',
        ...(rows.length ? rows : ['| – | no projects yet | 0 | 0 | 0 | 0 | 0 | 0 |']),
        '',
        '## What I would do next',
        '',
        '1. Merge anything that passed QA',
        '2. Run `npm run build` on each floor before the next milestone',
        '3. Grow a team only where work keeps waiting for free agents',
        '',
        '```bash',
        'SWARM_HOME=/tmp/cubefarm-demo SWARM_PORT=5260 node --import tsx server/index.ts --demo',
        '```',
        '```',
        '',
        `> I'm the demo CEO, so I can't act on "${short(text)}", but the real one would. See the [Claude Code docs](https://docs.claude.com/en/docs/claude-code/overview).`,
        '',
        demoRefsLine(s.floors),
        ...(next
          ? ['', `Next up on floor ${next.floor}: #${next.issue.number} ${next.issue.title}. Shall I keep the team on it?`, '```suggestions', 'Yes, keep them on it', 'Not now', 'Show me the plan', '```']
          : []),
        '```spoken',
        `Quick status: ${agents} agents are on ${issues} open issues${pending ? `, and ${pending} team change${pending === 1 ? ' waits' : 's wait'} for you` : ''}. The full report is in the card.${next ? ` Shall I keep the team on what's next?` : ''}`,
        '```',
        ...(nextFloor ? ['```idea research', `Research how other teams test phone layouts before floor ${nextFloor.floor} builds more`, `Research: how other teams test phone layouts, for floor ${nextFloor.floor}`, '```'] : []),
      ].join('\n');
    },
  };

  const [asked, changed = ''] = opts.prompt.split("\n\nYour changes since last time"); // the manager's changes (#207), after the rest
  const prompt = asked.split('\n\nSince you last looked:')[0].split('\n\nOpen decisions from the last 24 h')[0].replace(/\n\nThe manager asked you to always remember:[\s\S]*$/, ''); // the manager's answers to agents (ceo.ts toldCeo), open decisions (#208) and pinned notes (ceoMemory.ts)
  const where = prompt.match(/[Ff]loor (\d+) \(([^,)]+)/);
  const triage = prompt.match(/^Triage: pull request #(\d+) on floor (\d+)/);
  const run = triage
    ? () => scripts.triage(Number(triage[2]), Number(triage[1]), prompt)
    : prompt.startsWith('Research for the manager:')
      ? () => scripts.research(prompt.match(/^Research for the manager: "([\s\S]*?)"\n/)?.[1] ?? '', where ? Number(where[1]) : null)
    : prompt.startsWith('The manager changed work')
      ? () => scripts.changes(changed.split('\n').filter((l) => l.startsWith('- floor ')))
    : prompt.startsWith('Follow-up:')
      ? () => scripts.followup(prompt.split('\n').filter((l) => /^- \[e\d+\]/.test(l)))
    : /no longer needs triage/.test(prompt)
      ? async () => 'Nothing to do.'
      : /just joined the company/.test(prompt)
        ? () => scripts.onboard(Number(where?.[1]), where?.[2] ?? '')
        : /has a brief for floor/.test(prompt)
          ? () => scripts.plan(Number(where?.[1]), prompt.match(/"""([\s\S]*?)"""/)?.[1]?.trim() ?? '')
          : /Periodic review/.test(prompt)
            ? () => scripts.review()
            : () => scripts.chat(prompt.split('\n').slice(1).join(' ').trim() || prompt);

  const finish = (ok: boolean, text: string, error?: string) => {
    if (done) return;
    done = true;
    cb.tool(null);
    cb.finished({ ok, text, costUsd: ok ? 0.4 + Math.random() : 0.05, turns: 6 + Math.floor(Math.random() * 10), errors: error ? [error] : [] });
  };

  timers.push(
    setTimeout(async () => {
      try {
        cb.log([{ kind: 'system', text: `✻ Claude Code (demo) · ${opts.model} · ${opts.effort} effort · CEO` }]);
        const reply = withSpoken(await run());
        await writeReply(reply, opts, cb, () => stopped);
        finish(true, reply);
      } catch (err) {
        finish(false, '', stopped ? 'Stopped by manager' : (err as Error).message);
      }
    }, 500),
  );

  return {
    send(text) {
      timers.push(
        setTimeout(() => {
          if (stopped || done) return;
          const said = text.split('\n').slice(1).join(' ').replace(/^\(message \d+\) /, '').trim() || text;
          const reply = parseForwarded(said);
          cb.log([{ kind: 'text', text: `● Noted: "${short(reply?.reply ?? said, 70)}"` }]);
          cb.turn?.(withSpoken(reply ? answerReply(reply) : `Noted, I'll factor that in: "${short(said, 90)}"`));
        }, 1500),
      );
    },
    stop() {
      stopped = true;
      timers.forEach(clearTimeout);
      finish(false, '', 'Stopped by manager');
    },
  };
}
