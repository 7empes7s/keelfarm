import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { describe, expect, it } from 'vitest';
import { STEP_TOOLS, stepWords } from '../shared/ceoSteps.ts';
import { describeOfficeTool } from './agentRunner.ts';
import { EAST_DESKS, MAX_DESKS } from '../client/src/world/layout.ts';
import { FLOOR_SEATS, OFFICE_PLAYBOOK_MAX, PLAYBOOK_MAX, type QaStatus } from '../shared/types.ts';
import type { HttpError } from './httpError.ts';
import { MANDATE_MAX_CHARS } from '../shared/followups.ts';
import { actionCards, NOT_CARDS } from '../shared/ceoActions.ts';
import {
  AGENT_LOG_DEFAULT,
  AGENT_LOG_MAX,
  AGENT_LOG_MAX_CHARS,
  agentLogText,
  ceoJobPrompt,
  ceoSystemPrompt,
  checkCloseIssue,
  createOfficeTools,
  floorCapacity,
  IssueCap,
  issueRefusal,
  jobLabel,
  LOG_LINE_MAX,
  NOT_ASKED,
  planDependencies,
  plannedSize,
  PR_DIFF_MAX_CHARS,
  PR_FILES_MAX,
  prDiffText,
  qaReportText,
  scalePlan,
  tailLines,
  type CeoJob,
  type DependsRequest,
  type TeamNow,
} from './ceo.ts';
import { WAIT_OUTPUT_MAX } from './ceoWaitTools.ts';
import { RESEARCH_NO_FILING, RESEARCH_READ_ONLY, researchReadOnly } from './research.ts';

describe('seats', () => {
  it('match the desks the client draws', () => {
    expect(MAX_DESKS + EAST_DESKS.z.length).toBe(FLOOR_SEATS);
  });
});

describe('scalePlan (scale_team)', () => {
  // Desks 0-3: Ada and Linus are free, Grace and Alan busy; one new agent waits in the lobby.
  const team = (over: Partial<TeamNow> = {}): TeamNow => ({
    agents: [
      { id: 'ada', desk: 0, free: true },
      { id: 'grace', desk: 1, free: false },
      { id: 'linus', desk: 2, free: true },
      { id: 'alan', desk: 3, free: false },
    ],
    pendingHires: ['h1'],
    pendingLetGos: [],
    ...over,
  });

  it('counts waiting team changes as decided', () => {
    expect(plannedSize(team())).toBe(5);
    expect(plannedSize(team({ pendingLetGos: [{ id: 'l1', agentId: 'ada' }] }))).toBe(4);
  });

  it('grows by the difference', () => {
    expect(scalePlan(team(), 7, 10)).toEqual({ size: 7, hire: 2, cancelHires: [], letGo: [], cancelLetGos: [] });
  });

  it('withdraws a waiting let-go before asking for anyone new', () => {
    expect(scalePlan(team({ pendingHires: [], pendingLetGos: [{ id: 'l1', agentId: 'ada' }] }), 5, 10)).toEqual({ size: 5, hire: 1, cancelHires: [], letGo: [], cancelLetGos: ['l1'] });
  });

  it('withdraws waiting new agents, the newest first, before letting anyone go', () => {
    expect(scalePlan(team({ pendingHires: ['h1', 'h2'] }), 4, 10)).toEqual({ size: 4, hire: 0, cancelHires: ['h2', 'h1'], letGo: [], cancelLetGos: [] });
    expect(scalePlan(team({ pendingHires: ['h1', 'h2', 'h3'] }), 1, 10).cancelHires).toEqual(['h3', 'h2', 'h1']);
  });

  it('lets idle agents go first, from the highest desk', () => {
    expect(scalePlan(team(), 3, 10)).toEqual({ size: 3, hire: 0, cancelHires: ['h1'], letGo: ['linus'], cancelLetGos: [] });
    expect(scalePlan(team(), 1, 10).letGo).toEqual(['linus', 'ada', 'alan']);
  });

  it('skips agents already leaving', () => {
    expect(scalePlan(team({ pendingHires: [], pendingLetGos: [{ id: 'l1', agentId: 'linus' }] }), 2, 10).letGo).toEqual(['ada']);
  });

  it("keeps at least one agent, and no more than the floor's max", () => {
    expect(scalePlan(team(), 0, 10).size).toBe(1);
    expect(scalePlan(team(), 40, 10)).toMatchObject({ size: 10, hire: 5 });
    expect(scalePlan(team({ pendingHires: [] }), 4, 10)).toEqual({ size: 4, hire: 0, cancelHires: [], letGo: [], cancelLetGos: [] });
  });
});

describe('jobLabel', () => {
  const job = (kind: CeoJob['kind']): CeoJob => ({ kind, repoId: 'r1', at: 0 });
  const floor = { floor: 3, fullName: 'leonvanzyl/office-swarm' };

  it('names the floor and repo for floor jobs', () => {
    expect(jobLabel(job('onboard'), floor)).toBe('Onboarding floor 3 · office-swarm');
    expect(jobLabel(job('plan'), floor)).toBe('Planning floor 3 · office-swarm');
  });

  it('falls back to the full name when it has no owner', () => {
    expect(jobLabel(job('plan'), { floor: 1, fullName: 'solo' })).toBe('Planning floor 1 · solo');
  });

  it('says so when the floor is gone', () => {
    expect(jobLabel(job('onboard'), null)).toBe('Onboarding a removed floor');
    expect(jobLabel(job('plan'), null)).toBe('Planning a removed floor');
  });

  it('labels company-wide jobs without a floor', () => {
    expect(jobLabel(job('review'), floor)).toBe('Reviewing the company');
    expect(jobLabel(job('review'), null)).toBe('Reviewing the company');
    expect(jobLabel({ kind: 'chat', text: 'hi', at: 0 }, null)).toBe('Replying to you');
  });

  it('names the PR for a triage', () => {
    expect(jobLabel({ kind: 'triage', repoId: 'r1', prNumber: 108, at: 0 }, floor)).toBe('Triaging PR #108 · floor 3 · office-swarm');
  });
});

// The CEO only sees the office tools if the whole list converts to JSON Schema: one schema the SDK can't handle
// (z.record did this) empties tools/list, and the CEO silently loses every tool.
describe('office tools', () => {
  const connect = async () => {
    const floors: unknown[] = [];
    const calls: [string, unknown][] = [];
    const configured: unknown[] = [];
    const office = createOfficeTools({
      companyStatus: () => '{}',
      floorDetail: () => '{}',
      agentDetail: () => '{}',
      setFloorProfile: (a) => (floors.push(a), 'saved'),
      proposeCharter: () => 'proposed',
      resolveDecision: () => 'closed',
      proposeDesign: async (a) => (calls.push(['propose_design', a]), 'proposed'),
      setOfficePlaybook: (a) => (calls.push(['set_office_playbook', a]), 'saved'),
      applySetup: (a) => (calls.push(['apply_setup', a]), 'applied'),
      scaleTeam: () => '',
      configureAgent: (a) => (configured.push(a), 'ok'),
      fileIssue: async () => '',
      setDependencies: async () => '',
      closeIssue: async () => '',
      retryQa: async () => '',
      restartAgent: () => '',
      stopAgent: () => '',
      messageAgent: async () => '',
      assignIssue: async () => '',
      answerAgent: async (a) => (calls.push(['answer_agent', a]), 'sent'),
      askManagerChoice: (a) => (calls.push(['ask_manager_choice', a]), 'asked'),
      sendBack: async () => '',
      rerunChecks: async () => '',
      closePull: async () => '',
      escalate: async () => '',
      attachFile: async (a) => `attached ${a.path}`,
      keepFile: () => 'kept',
      setMandate: (a) => (calls.push(['set_mandate', a]), 'recorded'),
      agentLog: (a) => (calls.push(['agent_log', a]), 'log'),
      qaReport: (a) => (calls.push(['qa_report', a]), 'report'),
      worktreeFile: async (a) => (calls.push(['worktree_file', a]), 'file'),
      prDiff: async (a) => (calls.push(['pr_diff', a]), 'diff'),
      sendTelegram: async () => '',
      scanKeys: async () => '',
      makeDefaultAccount: () => '',
      editMessage: async () => '',
      waitFor: async (a) => (calls.push(['wait_for', a]), 'PR #7 on floor 1 merged.'),
      askManager: async (a) => (calls.push(['ask_manager', a]), 'The manager answered: yes'),
      consult: async (a) => (calls.push(['consult', a]), `Ada on floor 1 says:\n${'x'.repeat(20_000)}`),
      defineExperiment: (a) => (calls.push(['define_experiment', a]), 'defined'),
      sessionHistory: (a) => (calls.push(['session_history', a]), 'history'),
      react: (a) => (calls.push(['react', a]), 'reacted'),
      reply: (a) => (calls.push(['reply', a]), 'answered'),
      runExperiment: () => '', setFloorSwitches: () => '', setIssuePriority: async () => '', setCeoSetup: () => '', applyCharter: () => '', mergePull: async () => '', askIt: () => '', cloudflare: async () => '', itReport: () => '', problemsList: () => '', noteProblem: () => '',
    });
    const [serverSide, clientSide] = InMemoryTransport.createLinkedPair();
    await office.server.instance.connect(serverSide);
    const client = new Client({ name: 'test', version: '1.0.0' });
    await client.connect(clientSide);
    return { client, floors, calls, configured };
  };

  it('lists every tool the CEO relies on', async () => {
    const { client } = await connect();
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([
      'agent_detail',
      'agent_log',
      'answer_agent',
      'apply_charter',
      'apply_setup',
      'ask_it',
      'ask_manager',
      'ask_manager_choice',
      'assign_issue',
      'attach_file',
      'close_issue',
      'close_pull',
      'cloudflare',
      'company_status',
      'configure_agent',
      'consult',
      'define_experiment',
      'edit_message',
      'escalate',
      'file_issue',
      'floor_detail',
      'it_report',
      'keep_file',
      'make_default_account',
      'merge_pull',
      'message_agent',
      'note_problem', 'pr_diff', 'problems',
      'propose_charter',
      'propose_design',
      'qa_report',
      'react',
      'reply',
      'rerun_checks',
      'resolve_decision',
      'restart_agent',
      'retry_qa',
      'run_experiment',
      'scale_team',
      'scan_keys',
      'send_back',
      'send_telegram',
      'session_history',
      'set_ceo_setup',
      'set_dependencies',
      'set_floor_profile',
      'set_floor_switches',
      'set_issue_priority',
      'set_mandate',
      'set_office_playbook',
      'stop_agent',
      'wait_for',
      'worktree_file',
    ]);
  });

  // #150: the phone shows each call as a sentence; none may fall back to the tool's raw name.
  it('says every tool in plain words, with no raw tool name', async () => {
    const { client } = await connect();
    const { tools } = await client.listTools();
    for (const t of tools) {
      expect(STEP_TOOLS, t.name).toContain(t.name);
      const text = stepWords(`mcp__office__${t.name}`, `⏺ ${describeOfficeTool(t.name, { floor: 2, pr: 7, number: 7, agent_id: 'Ada', title: 'X', question: 'Q?', conditions: [{ kind: 'pr_merged', floor: 2, pr: 7 }] })}`).text;
      expect(text, t.name).not.toMatch(/_|\bmcp\b/);
    }
  });

  // #215: a card that looks tappable but opens nothing. A new tool that changes something needs a sample here and a ref.
  it('gives the card of every tool that changes something a destination', async () => {
    const { client } = await connect();
    const { tools } = await client.listTools();
    const f = { floor: 1 };
    const agent = { agent_id: 'Ada' };
    const samples: Record<string, Record<string, unknown>> = {
      set_floor_profile: { ...f, summary: 's' },
      set_office_playbook: { playbook: 'p' },
      apply_setup: { ...f, gap: 'preview' },
      scale_team: { ...f, size: 3, reason: 'r' },
      configure_agent: { ...agent, model: 'm' },
      file_issue: { ...f, title: 't', body: 'b' },
      set_dependencies: { ...f, number: 4, depends_on: [] },
      close_issue: { ...f, number: 4, reason: 'r' },
      retry_qa: { ...f, pr: 7 },
      send_back: { ...f, pr: 7, note: 'n' },
      rerun_checks: { ...f, pr: 7 },
      close_pull: { ...f, pr: 7, comment: 'c' },
      escalate: { ...f, pr: 7, reason: 'r' },
      set_mandate: { text: 't' },
      propose_charter: { ...f },
      propose_design: { ...f, title: 'Layout', question: 'Which layout?', options: [] },
      resolve_decision: { id: 'msg:4', outcome: 'o' },
      define_experiment: { name: 'n' },
      restart_agent: agent,
      stop_agent: { ...agent, reason: 'r' },
      message_agent: { ...f, ...agent, text: 't' },
      assign_issue: { ...f, number: 7 },
      answer_agent: { ...agent, text: 't' },
      ask_manager_choice: { ...agent, question: 'q' },
      send_telegram: { text: 't' },
      scan_keys: {},
      make_default_account: { account: 'claude-ultra' },
      wait_for: { conditions: [{ kind: 'pr_merged', floor: 1, pr: 7 }] },
      run_experiment: { experiment: 'x1', action: 'start', asked_in: 4 },
      set_floor_switches: { ...f, auto_merge: true, asked_in: 4 },
      set_issue_priority: { ...f, number: 7, priority: true, asked_in: 4 },
      set_ceo_setup: { model: 'claude-sonnet-5', asked_in: 4 },
      apply_charter: { ...f, reason: 'r', asked_in: 4 },
      merge_pull: { ...f, pr: 7, asked_in: 4 },
      ask_it: { question: 'Why is the disk full?' },
      cloudflare: { op: 'tunnel_ingress_add', hostname: 'clip.example.com', service: 'http://localhost:80' },
      it_report: { what: 'CI is down', where: 'ci', evidence: 'checks never started', blocking: false },
      note_problem: { title: 'Issue #4 had no acceptance criteria', cause: 'vague-brief' },
    };
    const acting = tools.map((t) => t.name).filter((name) => !NOT_CARDS.has(name));
    for (const name of acting) {
      expect(samples[name], `${name}: a card sample (or NOT_CARDS)`).toBeDefined();
      const [card] = actionCards([{ tool: name, ok: true, out: 'Done.', args: samples[name] }], () => 'acme/shop', () => 'a1');
      expect(card?.ref, `${name}: its card opens nothing`).toBeDefined();
    }
    expect(acting.length).toBe(Object.keys(samples).length);
  });

  it("checks the new tools' inputs before the office sees them", async () => {
    const { client, calls } = await connect();
    const ok = async (name: string, args: Record<string, unknown>) => !(await client.callTool({ name, arguments: args })).isError;
    expect(await ok('agent_log', { agent_id: 'ada', lines: 1000 })).toBe(true);
    expect(await ok('agent_log', { agent_id: 'ada', lines: 1001 })).toBe(false);
    expect(await ok('agent_log', { agent_id: 'ada', lines: 0 })).toBe(false);
    expect(await ok('worktree_file', { agent_id: 'ada', mode: 'diff_stat' })).toBe(true);
    expect(await ok('worktree_file', { agent_id: 'ada', mode: 'rm' })).toBe(false);
    expect(await ok('worktree_file', { agent_id: 'ada', mode: 'file', path: 'x'.repeat(501) })).toBe(false);
    expect(await ok('qa_report', { floor: 1, pr: 0 })).toBe(false);
    expect(await ok('pr_diff', { floor: 1, pr: 7, patch: true })).toBe(true);
    expect(await ok('set_mandate', { text: 'Keep polishing floor 3', floors: [3], expires_in_hours: 48 })).toBe(true);
    expect(await ok('set_mandate', { text: '' })).toBe(false);
    expect(await ok('set_mandate', { text: 'x'.repeat(MANDATE_MAX_CHARS + 1) })).toBe(false);
    expect(await ok('set_mandate', { text: 'forever', expires_in_hours: 24 * 91 })).toBe(false);
    expect(calls.map(([n]) => n)).toEqual(['agent_log', 'worktree_file', 'pr_diff', 'set_mandate']);
  });

  it("checks the chat tools' inputs (#118): react takes only its fixed emoji, reply needs a message and words", async () => {
    const { client, calls } = await connect();
    const ok = async (name: string, args: Record<string, unknown>) => !(await client.callTool({ name, arguments: args })).isError;
    expect(await ok('react', { emoji: '👍' })).toBe(true);
    expect(await ok('react', { emoji: '✅', message_id: 4 })).toBe(true);
    expect(await ok('react', { emoji: '💩' })).toBe(false);
    expect(await ok('reply', { message_id: 4, text: 'Done.' })).toBe(true);
    expect(await ok('reply', { message_id: 4, text: '' })).toBe(false);
    expect(await ok('reply', { text: 'Done.' })).toBe(false);
    expect(calls.map(([n]) => n)).toEqual(['react', 'react', 'reply']);
  });

  it('checks propose_design: 2 or 3 options, at most 3 shots each, a real preview link (#209)', async () => {
    const { client, calls } = await connect();
    const ok = async (args: Record<string, unknown>) => !(await client.callTool({ name: 'propose_design', arguments: args })).isError;
    const opt = (label: string) => ({ label, shots: ['/tmp/a.png'] });
    const base = { floor: 1, title: 'Cards', question: 'Which look?', options: [opt('Flat'), { ...opt('Raised'), previewUrl: 'https://example.com/b' }] };
    expect(await ok(base)).toBe(true);
    expect(await ok({ ...base, issue: 12 })).toBe(true);
    expect(await ok({ ...base, options: [opt('Only one')] })).toBe(false);
    expect(await ok({ ...base, options: [opt('a'), opt('b'), opt('c'), opt('d')] })).toBe(false);
    expect(await ok({ ...base, options: [opt('a'), { label: 'b', shots: ['/1', '/2', '/3', '/4'] }] })).toBe(false);
    expect(await ok({ ...base, options: [opt('a'), { ...opt('b'), previewUrl: 'not a link' }] })).toBe(false);
    expect(await ok({ ...base, question: '' })).toBe(false);
    expect(calls.filter(([n]) => n === 'propose_design')).toHaveLength(2);
  });

  it("checks the waiting tools' inputs (#28)", async () => {
    const { client, calls } = await connect();
    const ok = async (name: string, args: Record<string, unknown>) => !(await client.callTool({ name, arguments: args })).isError;
    expect(await ok('wait_for', { conditions: [{ kind: 'pr_merged', floor: 1, pr: 7 }, { kind: 'usage', usage: 'normal' }], timeout_min: 30 })).toBe(true);
    expect(await ok('wait_for', { conditions: [] })).toBe(false);
    expect(await ok('wait_for', { conditions: [{ kind: 'pr_merged', floor: 1, pr: 7 }], timeout_min: 31 })).toBe(false);
    expect(await ok('wait_for', { conditions: [{ kind: 'lunch' }] })).toBe(false);
    expect(await ok('wait_for', { conditions: Array(6).fill({ kind: 'usage' }) })).toBe(false);
    expect(await ok('ask_manager', { question: 'Ship it?', suggestions: ['Yes', 'No'], timeout_min: 120 })).toBe(true);
    expect(await ok('ask_manager', { question: 'Ship it?', timeout_min: 121 })).toBe(false);
    expect(await ok('ask_manager', { question: 'Ship it?', suggestions: ['a', 'b', 'c', 'd', 'e'] })).toBe(false);
    expect(await ok('ask_manager', { question: 'Ship it?', suggestions: ['x'.repeat(61)] })).toBe(false);
    expect(await ok('consult', { floor: 1, question: 'How does the restore approval flow work?', hint: 'as a security reviewer' })).toBe(true);
    expect(await ok('consult', { floor: 1, agent_id: 'ada', question: '' })).toBe(false);
    expect(await ok('consult', { floor: 1, question: 'x'.repeat(2001) })).toBe(false);
    expect(calls.map(([n]) => n)).toEqual(['wait_for', 'ask_manager', 'consult']);
  });

  it("caps what the waiting tools return (#28)", async () => {
    const { client } = await connect();
    const res = (await client.callTool({ name: 'consult', arguments: { floor: 1, question: 'Why?' } })) as { content: { text: string }[] };
    expect(res.content[0].text.length).toBeLessThanOrEqual(WAIT_OUTPUT_MAX);
    expect(res.content[0].text).toMatch(/^Ada on floor 1 says:\n/);
  });

  it('session_history takes its filters and refuses more than 90 days back', async () => {
    const { client, calls } = await connect();
    const ok = async (args: Record<string, unknown>) => !(await client.callTool({ name: 'session_history', arguments: args })).isError;
    expect(await ok({ agent: 'Grace', issue: 41, days: 2 })).toBe(true);
    expect(await ok({ days: 91 })).toBe(false);
    expect(await ok({ page: 0 })).toBe(false);
    expect(calls).toEqual([['session_history', { agent: 'Grace', issue: 41, days: 2 }]]);
  });

  it('define_experiment takes 2 to 4 variants and the lab kinds only', async () => {
    const { client, calls } = await connect();
    const ok = async (args: Record<string, unknown>) => !(await client.callTool({ name: 'define_experiment', arguments: args })).isError;
    const v = (name: string, more = {}) => ({ name, ...more });
    expect(await ok({ name: 'Test first', hypothesis: 'Fewer rounds', variants: [v('Current'), v('Test first', { prompt: 'Write the failing test first.', effort: 'high' })] })).toBe(true);
    expect(await ok({ name: 'One', hypothesis: 'h', variants: [v('Only')] })).toBe(false);
    expect(await ok({ name: 'CEO', hypothesis: 'h', kinds: ['ceo-chat'], variants: [v('A'), v('B')] })).toBe(false);
    expect(await ok({ name: 'Cli', hypothesis: 'h', variants: [v('A'), v('B', { qa_cli: 'aider' })] })).toBe(false);
    expect(calls.map(([n]) => n)).toEqual(['define_experiment']);
  });

  it("checks answer_agent and ask_manager_choice: a short answer, 2 to 4 options and a recommendation", async () => {
    const { client, calls } = await connect();
    const ok = async (name: string, args: Record<string, unknown>) => !(await client.callTool({ name, arguments: args })).isError;
    expect(await ok('answer_agent', { agent_id: 'ada', text: 'Next to the code, like the rest of the repo.' })).toBe(true);
    expect(await ok('answer_agent', { agent_id: 'ada', text: '' })).toBe(false);
    expect(await ok('answer_agent', { agent_id: 'ada', text: 'x'.repeat(2001) })).toBe(false);
    const ask = { agent_id: 'ada', question: 'Red or blue badge?', options: ['Red', 'Blue'], recommendation: 'Blue: the brand colour.' };
    expect(await ok('ask_manager_choice', ask)).toBe(true);
    expect(await ok('ask_manager_choice', { ...ask, options: ['Red'] })).toBe(false);
    expect(await ok('ask_manager_choice', { ...ask, options: ['a', 'b', 'c', 'd', 'e'] })).toBe(false);
    expect(await ok('ask_manager_choice', { ...ask, recommendation: undefined })).toBe(false);
    expect(calls.map(([n]) => n)).toEqual(['answer_agent', 'ask_manager_choice']);
  });

  it("takes an agent's Tools & skills switches as lists of names", async () => {
    const { client, configured } = await connect();
    await client.callTool({ name: 'configure_agent', arguments: { agent_id: 'ada', tools_off: ['canva', 'mcp:notion'], tools_reset: ['pdf'] } });
    expect(configured).toEqual([{ agent_id: 'ada', tools_off: ['canva', 'mcp:notion'], tools_reset: ['pdf'] }]);
  });

  it('still takes preview_env as a map of strings', async () => {
    const { client, floors } = await connect();
    await client.callTool({ name: 'set_floor_profile', arguments: { floor: 1, preview_env: { VITE_API: 'http://localhost:{port}' } } });
    expect(floors).toEqual([{ floor: 1, preview_env: { VITE_API: 'http://localhost:{port}' } }]);
  });

  it('takes the office playbook up to its length cap (#50)', async () => {
    const { client, calls } = await connect();
    expect((await client.callTool({ name: 'set_office_playbook', arguments: { playbook: '- Minimal diff.' } })).isError).toBeFalsy();
    expect((await client.callTool({ name: 'set_office_playbook', arguments: { playbook: 'x'.repeat(OFFICE_PLAYBOOK_MAX + 1) } })).isError).toBe(true);
    expect(calls).toEqual([['set_office_playbook', { playbook: '- Minimal diff.' }]]);
  });

  it("takes a floor's playbook up to its length cap", async () => {
    const { client, floors } = await connect();
    const playbook = '## Layers\n- server/ never imports client/';
    await client.callTool({ name: 'set_floor_profile', arguments: { floor: 1, playbook } });
    expect(floors).toEqual([{ floor: 1, playbook }]);
    const tooLong = await client.callTool({ name: 'set_floor_profile', arguments: { floor: 1, playbook: 'x'.repeat(PLAYBOOK_MAX + 1) } });
    expect(tooLong.isError).toBe(true);
    expect(floors).toHaveLength(1);
  });
  it("checks propose_charter's input with its schema (#48)", async () => {
    const { client } = await connect();
    const ok = async (args: Record<string, unknown>) => !(await client.callTool({ name: 'propose_charter', arguments: { floor: 1, reason: 'Tighter', ...args } })).isError;
    expect(await ok({ focus: 'O1', objectives: [{ id: 'O1', outcome: 'Fast' }], standards: ['Tests pass'], non_goals: ['Accounts'] })).toBe(true);
    expect(await ok({ objectives: [{ id: 'goal-1', outcome: 'Fast' }] })).toBe(false);
    expect(await ok({ standards: ['x'.repeat(201)] })).toBe(false);
    expect(await ok({ objectives: Array.from({ length: 9 }, () => ({ outcome: 'Fast' })) })).toBe(false);
    expect(await ok({ reason: '' })).toBe(false);
  });
});

describe('checkCloseIssue (close_issue)', () => {
  const pulls = [
    { number: 20, state: 'OPEN', closesIssues: [4] },
    { number: 21, state: 'MERGED', closesIssues: [5] },
    { number: 22, state: 'CLOSED', closesIssues: [6] },
  ];
  const status = (state: 'OPEN' | 'CLOSED' | null, number = 6) => {
    try {
      checkCloseIssue({ floor: 1, number, state, pulls });
      return 'ok';
    } catch (err) {
      return (err as HttpError).status;
    }
  };

  it('closes an open issue, even one a merged or closed PR once named', () => {
    expect(status('OPEN')).toBe('ok');
    expect(status('OPEN', 5)).toBe('ok');
  });

  it('refuses a closed or unknown issue, which is how another floor\'s issue looks too', () => {
    expect(status('CLOSED')).toBe(404);
    expect(status(null)).toBe(404);
    expect(() => checkCloseIssue({ floor: 2, number: 6, state: 'CLOSED', pulls })).toThrow('#6 on floor 2 is already closed.');
  });

  it('refuses an issue an open PR closes', () => {
    expect(status('OPEN', 4)).toBe(409);
    expect(() => checkCloseIssue({ floor: 1, number: 4, state: 'OPEN', pulls })).toThrow('PR #20 closes #4. Close or finish that pull request first.');
  });
});

describe('planDependencies (set_dependencies)', () => {
  // #1 ← #2 ← #3 is a two-step chain; #5 waits for #4; #9 is closed.
  const base: DependsRequest = {
    floor: 1,
    number: 4,
    dependsOn: [],
    issues: [
      { number: 1, body: 'Set up the skeleton' },
      { number: 2, body: 'Depends on #1' },
      { number: 3, body: 'Depends on #2\n\nThe rest' },
      { number: 4, body: 'Some text' },
      { number: 5, body: 'Intro\n\nDepends on #4\n\nMore' },
      { number: 6, body: 'Free' },
    ],
    closed: (n) => n === 9,
    inProgress: false,
  };
  const deps = (over: Partial<DependsRequest>) => planDependencies({ ...base, ...over });

  it('rewrites the Depends on line and leaves the rest of the body alone', () => {
    expect(deps({ number: 5, dependsOn: [6] }).body).toBe('Depends on #6\n\nIntro\n\nMore');
    expect(deps({ number: 5, dependsOn: [] }).body).toBe('Intro\n\nMore');
    expect(deps({ number: 6, dependsOn: [1, 4] })).toEqual({ body: 'Depends on #1, #4\n\nFree', summary: '#6 on floor 1: depends on #1, #4.' });
    expect(deps({ number: 4, dependsOn: [] })).toEqual({ body: null, summary: '#4 on floor 1: no dependencies.' });
  });

  it('refuses a closed or unknown issue', () => {
    expect(() => deps({ number: 9 })).toThrow('#9 is closed.');
    expect(() => deps({ number: 42 })).toThrow('There is no open issue #42 on floor 1.');
  });

  it('refuses dependencies on itself, on closed and on unknown issues', () => {
    expect(() => deps({ dependsOn: [4] })).toThrow("#4 can't depend on itself.");
    expect(() => deps({ dependsOn: [9] })).toThrow("#9 is closed, so there's nothing to wait for.");
    expect(() => deps({ dependsOn: [42] })).toThrow('There is no open issue #42 on floor 1.');
  });

  it('refuses a cycle', () => {
    expect(() => deps({ number: 1, dependsOn: [3] })).toThrow('#3 already waits for #1, directly or through other issues, so that would be a cycle.');
    expect(() => deps({ number: 4, dependsOn: [5] })).toThrow(/#5 already waits for #4/);
  });

  it('refuses a chain deeper than two steps', () => {
    expect(() => deps({ number: 1, dependsOn: [6] })).toThrow('That makes a dependency chain 3 steps deep through #1. Keep chains to 2 steps at most: fold the dependent pieces into one issue instead of splitting further.');
    expect(() => deps({ number: 6, dependsOn: [3] })).toThrow(/3 steps deep/);
    expect(deps({ number: 6, dependsOn: [2] }).body).toBe('Depends on #2\n\nFree');
  });

  it('leaves an issue in progress alone', () => {
    expect(() => deps({ inProgress: true })).toThrow("#4 is already in progress, so its dependencies can't change.");
  });
});

describe('planning guidance', () => {
  const system = ceoSystemPrompt({ name: 'Luna', company: 'Acme', manager: 'Sam', notesFile: 'notes.md', sessionLimit: 0, maxAgents: 10, scaling: 'approve' });
  const floor = { floor: 2, fullName: 'acme/app', clone: '/clones/app', mission: 'Add voice messages', backlog: 0 };
  const plan = ceoJobPrompt({ kind: 'plan', repoId: 'r1', at: 0 }, floor);
  const review = ceoJobPrompt({ kind: 'review', at: 0 }, null);

  it('plans whole features, not slices per developer', () => {
    for (const old of ['small, well-specified', 'one agent-session each', 'at least one per developer', 'split big pieces', 'keep foundation issues small']) expect(system).not.toContain(old);
    expect(system).toContain('An issue is a whole feature the manager would recognise');
    expect(system).toContain('Split a feature only when its parts are truly independent AND touch different files, or when one risky foundation part should land and be tested first.');
    expect(system).toContain('Never split a feature just to give idle agents something to do');
  });

  it('keeps the dependency rules and the issue cap, and points at the QA queue', () => {
    expect(system).toContain('the same agents build and test, so PRs queued for QA (capacity.prsAwaitingQa) mean fewer, bigger issues');
    expect(system).toContain('Most briefs need 1 to 4 issues.');
    expect(system).toContain('Keep dependency chains to two steps at most.');
    expect(system).toContain('with set_dependencies');
    expect(system).toContain('File at most 12 issues per job');
  });

  it('plan job: one issue per feature, a skeleton first only for an empty repo', () => {
    expect(plan).not.toContain('side by side');
    expect(plan).toContain('One issue per whole feature.');
    expect(plan).toContain('Only for an empty or nearly empty repository does a skeleton issue come first');
  });

  it('review job: sizes teams from throughput, and idle agents are no reason to slice features', () => {
    expect(review).toContain('team size against throughput');
    expect(review).toContain('PRs piling up in QA (then plan fewer, bigger issues)');
    expect(review).toContain('Idle agents are not a reason to slice features');
  });
});

describe('team guidance', () => {
  const prompt = (scaling: 'approve' | 'auto') => ceoSystemPrompt({ name: 'Luna', company: 'Acme', manager: 'Sam', notesFile: 'notes.md', sessionLimit: 0, maxAgents: 8, scaling });

  it('sizes teams from throughput, within the floor max, and keeps one agent', () => {
    expect(prompt('approve')).toContain("Size each floor's team from its throughput");
    expect(prompt('approve')).toContain('A floor holds at most 8.');
    expect(prompt('approve')).toContain('Every floor keeps at least one agent.');
    for (const old of ['QA tester', 'job description', 'specialty', 'propose_hire', 'update_job']) expect(prompt('approve')).not.toContain(old);
  });

  it('says who decides on team changes', () => {
    expect(prompt('approve')).toContain('The manager approves every change, and sets up each new agent before hiring them.');
    expect(prompt('auto')).toContain("Team changes apply straight away, within the floor's max, so be deliberate.");
  });

  it('onboarding sizes the team instead of hiring specialists', () => {
    const onboard = ceoJobPrompt({ kind: 'onboard', repoId: 'r1', at: 0 }, { floor: 2, fullName: 'acme/app', clone: '/clones/app', mission: '', backlog: 3 });
    expect(onboard).toContain('scale_team');
    expect(onboard).not.toContain('update_job');
  });
});

describe('triage', () => {
  const system = ceoSystemPrompt({ name: 'Luna', company: 'Acme', manager: 'Sam', notesFile: 'notes.md', sessionLimit: 0, maxAgents: 10, scaling: 'approve' });
  const floor = { floor: 2, fullName: 'acme/app', clone: '/clones/app', mission: '', backlog: 3 };
  const job: CeoJob = { kind: 'triage', repoId: 'r1', prNumber: 108, at: 0 };
  const pr = {
    number: 108,
    title: 'Jukebox volume',
    url: 'https://github.com/acme/app/pull/108',
    round: 3,
    why: 'it still conflicts with main after 3 fixes',
    summary: 'Works, but the slider overflows on phones.',
    fixInstructions: 'Wrap the slider below 480px.',
    mergeNote: 'the conflict was never resolved',
    checks: 'failing',
    failedChecks: ['CI / e2e'],
    pendingChecks: [],
    mergeable: 'CONFLICTING',
    mergeState: 'DIRTY',
    triage: 1,
  };

  it('gives the job everything QA and GitHub know about the PR', () => {
    const prompt = ceoJobPrompt(job, floor, pr);
    for (const fact of ['#108', 'Jukebox volume', 'QA round 3', pr.summary, pr.fixInstructions, pr.mergeNote, pr.why, 'GitHub checks: failing (failed: CI / e2e)', 'mergeable: CONFLICTING (DIRTY)', 'triage 1 of 2']) {
      expect(prompt).toContain(fact);
    }
    expect(prompt).toContain('retry_qa, send_back, rerun_checks, close_pull or escalate');
  });

  it('has nothing to do once the PR is no longer stuck', () => {
    expect(ceoJobPrompt(job, floor, null)).toBe('Pull request #108 no longer needs triage. Reply "Nothing to do."');
  });

  it('adds a triage section to the system prompt and keeps its safety rules', () => {
    expect(system).toContain('Triage jobs:');
    expect(system).toContain('They are read-only to you. You cannot run shell commands.');
    expect(system).toContain('Change things only through the mcp__office__ tools.');
  });
});

describe('floorCapacity', () => {
  // #1 ← #2 ← #3, and #5 waits for #4. #2 is already in progress.
  const issues = [
    { number: 1, body: 'Skeleton' },
    { number: 2, body: 'Depends on #1' },
    { number: 3, body: 'Depends on #2' },
    { number: 4, body: 'Free' },
    { number: 5, body: 'Depends on #4' },
  ];
  const qa: { prNumber: number; status: QaStatus }[] = [
    { prNumber: 10, status: 'queued' },
    { prNumber: 11, status: 'testing' },
    { prNumber: 12, status: 'fixing' },
    { prNumber: 13, status: 'passed' },
    { prNumber: 14, status: 'failed' },
    { prNumber: 15, status: 'needs-human' },
    { prNumber: 16, status: 'queued' }, // a re-test round
    { prNumber: 20, status: 'queued' }, // closed since
  ];
  const cap = floorCapacity({ issues, inProgress: (n) => n === 2, openPrs: [10, 11, 12, 13, 14, 15, 16], qa });

  it('counts only issues not yet in progress as waiting on others', () => {
    expect(cap.issuesWaitingOnOthers).toBe(2); // #3 and #5; #2 is in progress
    expect(floorCapacity({ issues, inProgress: () => false, openPrs: [], qa: [] }).issuesWaitingOnOthers).toBe(3);
  });

  it('keeps the longest dependency chain', () => {
    expect(cap.longestDependencyChain).toBe(2);
    expect(floorCapacity({ issues: [], inProgress: () => false, openPrs: [], qa: [] }).longestDependencyChain).toBe(0);
  });

  it('counts open PRs queued for or in QA', () => {
    expect(cap.prsAwaitingQa).toBe(3); // #10, #11, #16
  });
});

describe('IssueCap', () => {
  it('refuses the 13th issue and says the next manager message allows more', () => {
    const cap = new IssueCap(12);
    for (let i = 0; i < 12; i++) {
      cap.check();
      cap.record('a/b');
    }
    expect(() => cap.check()).toThrow("You already filed 12 issues in this job. That's plenty for one milestone. The manager's next message allows more.");
  });

  it('resets when a manager message arrives, and still counts the whole job', () => {
    const cap = new IssueCap(2);
    cap.record('a/b');
    cap.record('c/d');
    expect(() => cap.check()).toThrow();
    cap.managerMessage();
    expect(() => cap.check()).not.toThrow();
    cap.record('a/b');
    expect(cap.total).toBe(3);
    expect([...cap.repos]).toEqual(['a/b', 'c/d']);
  });
});

describe('follow-ups (#27)', () => {
  const mandate = { id: 'm1', text: 'Keep polishing floor 3 until it is perfected', floors: [3], expiresAt: null, at: 0 };
  const events = [
    { id: 'e1', kind: 'merged' as const, key: 'merged:a#13', label: '#13 merged', text: 'PR #13 "Jukebox" merged on floor 3 (o/office).', at: 0 },
    { id: 'e2', kind: 'merged' as const, key: 'merged:a#14', label: '#14 merged', text: 'PR #14 "Lift" merged on floor 3 (o/office).', at: 1 },
  ];

  it('file_issue in a follow-up needs a mandate for the floor, and says how to get one', () => {
    expect(issueRefusal({ kind: 'followup', asked: false, floor: 3, mandate })).toBeNull();
    const refused = issueRefusal({ kind: 'followup', asked: false, floor: 2, mandate: null });
    expect(refused).toMatch(/No standing mandate .* floor 2/);
    expect(refused).toMatch(/final message/);
    expect(refused).toMatch(/set_mandate/);
  });

  it('refuses file_issue during research, even after a message from the manager', () => {
    for (const asked of [false, true]) expect(issueRefusal({ kind: 'research', asked, floor: 3, mandate })).toBe(RESEARCH_NO_FILING);
    expect(RESEARCH_NO_FILING).toMatch(/suggestions/);
    expect(RESEARCH_NO_FILING).toMatch(/plan job/);
  });

  it('refuses every tool that acts while research runs, and keeps the read-only ones', async () => {
    let researching = true;
    const ok = () => 'ok';
    const office = createOfficeTools(
      researchReadOnly(
        {
          companyStatus: ok, floorDetail: ok, agentDetail: ok, setFloorProfile: ok, setOfficePlaybook: ok, applySetup: ok, scaleTeam: ok, configureAgent: ok, keepFile: ok, setMandate: ok, agentLog: ok, qaReport: ok,
          fileIssue: async () => 'filed', setDependencies: async () => 'ok', closeIssue: async () => 'ok', retryQa: async () => 'ok', sendBack: async () => 'ok', rerunChecks: async () => 'ok',
          closePull: async () => 'ok', escalate: async () => 'ok', attachFile: async () => 'ok', worktreeFile: async () => 'ok', prDiff: async () => 'ok', sendTelegram: async () => 'ok', scanKeys: async () => 'ok', makeDefaultAccount: () => 'ok', editMessage: async () => 'ok',
          restartAgent: ok, stopAgent: ok, messageAgent: async () => 'ok', assignIssue: async () => 'ok', answerAgent: async () => 'ok', askManagerChoice: ok, defineExperiment: ok, sessionHistory: ok, proposeCharter: ok, resolveDecision: ok, proposeDesign: async () => 'ok',
          waitFor: async () => 'ok', askManager: async () => 'ok', consult: async () => 'ok', react: ok, reply: ok, problemsList: ok, noteProblem: ok,
          runExperiment: ok, setFloorSwitches: ok, setIssuePriority: async () => 'ok', setCeoSetup: ok, applyCharter: ok, mergePull: async () => 'ok', askIt: ok, cloudflare: async () => 'ok', itReport: ok,
        },
        () => researching,
      ),
    );
    expect(await office.call('file_issue', { floor: 1, title: 'A feature', body: 'Do it' })).toBe(`Refused: ${RESEARCH_NO_FILING}`);
    expect(await office.call('scale_team', { floor: 1, size: 3, reason: 'more' })).toBe(`Refused: ${RESEARCH_READ_ONLY}`);
    expect(await office.call('send_telegram', { text: 'hi' })).toBe(`Refused: ${RESEARCH_READ_ONLY}`);
    expect(await office.call('message_agent', { floor: 1, agent_id: 'a1', text: 'hi' })).toBe(`Refused: ${RESEARCH_READ_ONLY}`);
    expect(await office.call('company_status', {})).toBe('ok');
    expect(await office.call('session_history', { agent: 'Grace', issue: 41 })).toBe('ok'); // read-only
    researching = false;
    expect(await office.call('file_issue', { floor: 1, title: 'A feature', body: 'Do it' })).toBe('filed');
  });

  it('keeps the old rule for every other job', () => {
    expect(issueRefusal({ kind: 'review', asked: false, floor: 3, mandate })).toBe(NOT_ASKED);
    expect(issueRefusal({ kind: 'chat', asked: true, floor: 3, mandate: null })).toBeNull();
    expect(issueRefusal({ kind: 'followup', asked: true, floor: 2, mandate: null })).toBeNull(); // the manager messaged mid-job
  });

  it("lists the events with their ids and the mandates in the job's prompt", () => {
    const job: CeoJob = { kind: 'followup', events, at: 0 };
    const p = ceoJobPrompt(job, null, null, [mandate]);
    expect(p).toContain('[e1] PR #13');
    expect(p).toContain('[e2] PR #14');
    expect(p).toContain('"Keep polishing floor 3 until it is perfected" (floor 3)');
    expect(p).toContain('"Nothing to do."');
    expect(ceoJobPrompt(job, null, null, [])).toContain('There are no standing mandates: file no issues.');
  });

  it("names the latest event in the CEO's presence line", () => {
    expect(jobLabel({ kind: 'followup', events: events.slice(0, 1), at: 0 }, null)).toBe('Following up on #13 merged');
    expect(jobLabel({ kind: 'followup', events, at: 0 }, null)).toBe('Following up on #14 merged and 1 more');
  });
});

describe('read-only tools: output caps', () => {
  it('agent_log keeps the last lines, 200 by default and 1000 at most', () => {
    const lines = Array.from({ length: 1500 }, (_, i) => `line ${i}`);
    expect(tailLines(lines).lines).toHaveLength(AGENT_LOG_DEFAULT);
    expect(tailLines(lines).lines.at(-1)).toBe('line 1499');
    expect(tailLines(lines, 5000).lines).toHaveLength(AGENT_LOG_MAX);
    expect(tailLines(lines, 3)).toEqual({ lines: ['line 1497', 'line 1498', 'line 1499'], cut: true });
    expect(tailLines(['a', 'b'], 10)).toEqual({ lines: ['a', 'b'], cut: false });
  });

  it('agent_log cuts long lines and the whole output', () => {
    const long = Array.from({ length: 1000 }, () => 'x'.repeat(5000));
    const out = tailLines(long, 1000);
    expect(out.lines.every((l) => l.length <= LOG_LINE_MAX)).toBe(true);
    expect(out.lines.join('\n').length).toBeLessThanOrEqual(AGENT_LOG_MAX_CHARS);
    expect(out.cut).toBe(true);
  });

  it('pr_diff lists at most 100 files and cuts the diff', () => {
    const files = Array.from({ length: 150 }, (_, i) => ({ path: `src/f${i}.ts`, additions: 2, deletions: 1 }));
    const text = prDiffText({ files, diff: 'd'.repeat(PR_DIFF_MAX_CHARS * 2) });
    expect(text.split('\n')[0]).toBe('150 files changed, +300 −150');
    expect(text).toContain(`src/f${PR_FILES_MAX - 1}.ts`);
    expect(text).not.toContain(`src/f${PR_FILES_MAX}.ts`);
    expect(text).toContain('… and 50 more');
    expect(text.length).toBeLessThan(PR_DIFF_MAX_CHARS + 8000);
    expect(prDiffText({ files: files.slice(0, 1), diff: null })).toBe('1 file changed, +2 −1\n  src/f0.ts +2 −1');
  });

  it('agent_log and qa_report mask every text they return', () => {
    const mask = (t: string) => t.replaceAll('sk-secret', '***');
    const agent = { name: 'Ada', status: 'error', task: 'build', issueNumber: 3, issueTitle: 'Fix', prNumber: null, branch: 'b', startedAt: 0, endedAt: null, turns: 4, costUsd: 1.234, lastError: 'bad key sk-secret' };
    const log = agentLogText(agent, { floor: 2, doing: null, lines: ['one', 'uses sk-secret'], mask });
    expect(log).not.toContain('sk-secret');
    expect(JSON.parse(log.split('\n')[0])).toMatchObject({ name: 'Ada', floor: 2, issue: { number: 3 }, costUsd: 1.23, endedAt: null });
    expect(log.endsWith('--- the last 2 lines ---\none\nuses ***')).toBe(true);
    const rec = { prNumber: 7, status: 'fixing' as QaStatus, round: 2, summary: 'leaked sk-secret', checks: [{ name: 'build', result: 'fail', details: 'sk-secret' }], fixInstructions: null, stuckWhy: null, commentUrl: null, shots: [{ caption: 'home', page: '/', mime: 'image/png' }] };
    const qa = qaReportText(rec, 2, mask, (i) => `shot-${i}.png`);
    expect(qa).not.toContain('sk-secret');
    expect(JSON.parse(qa)).toMatchObject({ pr: 7, floor: 2, verdict: 'fail', screenshots: [{ caption: 'home', file: 'shot-0.png' }] });
  });
});
