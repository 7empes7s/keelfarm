import { describe, expect, it } from 'vitest';
import { filedWords, shortDuration, stepNote, stepWords } from './ceoSteps.ts';

const office = (name: string, line: string, nameOf?: (id: string) => string | null) => stepWords(`mcp__office__${name}`, `⏺ ${line}`, nameOf).text;
const ID = '6f1c2a9e-1b2c-4d5e-8f90-123456789abc';

describe('steps in plain words (#150)', () => {
  it('says what an office tool does, with its target', () => {
    expect(office('company_status', '🏢 company_status')).toBe('Checking the floors');
    expect(office('pr_diff', '🔀 pr_diff PR #122 → floor 3')).toBe("Reading PR #122's changes on floor 3");
    expect(office('file_issue', '📝 file_issue "Bigger joystick" → floor 3')).toBe('Filing an issue on floor 3: “Bigger joystick”');
    expect(office('close_issue', '🗂️ close_issue #9 → floor 1')).toBe('Closing #9 on floor 1');
    expect(office('scale_team', '📈 scale_team floor 2 → 4: busy')).toBe("Sizing floor 2's team to 4");
    expect(office('qa_report', '🧪 qa_report PR #5 → floor 1')).toBe("Reading PR #5's QA report on floor 1");
    expect(office('ask_manager', '❓ ask_manager: Finish the PRs first?')).toBe('Asking you: “Finish the PRs first?”');
    expect(office('consult', '🧑‍💻 consult floor 3: How do approvals work?')).toBe("Asking floor 3's team about floor 3's code");
  });

  it('says what a wait waits for, and for how long at most', () => {
    expect(office('wait_for', '⏳ wait_for pr_merged floor 3 PR #138 · up to 10 min')).toBe('Waiting for PR #138 to merge on floor 3 (up to 10 min)');
    expect(office('wait_for', '⏳ wait_for pr_qa floor 1 PR #4 or issue_closed floor 1 #3')).toBe("Waiting for QA's verdict on PR #4 on floor 1 or 1 more");
    expect(office('wait_for', `⏳ wait_for agent_idle ${ID} · up to 2 min`, (id) => (id === ID ? 'Linus' : null))).toBe('Waiting for Linus to finish (up to 2 min)');
    expect(office('wait_for', '⏳ wait_for usage normal')).toBe("Waiting for Claude's usage to be normal");
  });

  it('names agents, never their ids', () => {
    const names = (id: string) => (id === ID ? 'Ada' : null);
    expect(office('message_agent', `🏢 message_agent({"agent_id":"${ID}","text":"hi"})`, names)).toBe('Messaging Ada');
    expect(office('agent_log', `📜 agent_log ${ID}`, names)).toBe("Reading Ada's log");
    expect(office('agent_detail', `🔎 agent_detail ${ID}`)).toBe('Checking on an agent');
    expect(office('restart_agent', '🏢 restart_agent({"agent_id":"Grace"})')).toBe('Restarting Grace');
    expect(office('stop_agent', '🏢 stop_agent({"agent_id":"Grace","reason":"closed"})')).toBe('Stopping Grace');
  });

  it('says what a built-in tool does, with the file, search or site', () => {
    expect(stepWords('Read', '⏺ Read shared/files.ts').text).toBe('Reading shared/files.ts');
    expect(stepWords('Read', '⏺ Read ceo/NOTES.md').text).toBe('Reading its notes');
    expect(stepWords('Edit', '⏺ Update(ceo/NOTES.md)').text).toBe('Updating its notes');
    expect(stepWords('Grep', '⏺ Grep "useTodos"').text).toBe('Searching the code for “useTodos”');
    expect(stepWords('Grep').text).toBe("Searching the office's code");
    expect(stepWords('WebSearch', '⏺ Search "mobile joystick UX"').text).toBe('Searching the web: mobile joystick UX');
    expect(stepWords('WebFetch', '⏺ Fetch https://developer.apple.com/design/x').text).toBe('Reading developer.apple.com');
    expect(stepWords('Skill', '⏺ Skill frontend-design').text).toBe('Using the frontend-design skill');
    expect(stepWords('mcp__claude_ai_Notion__notion-search').text).toBe('Using Notion');
  });

  it('cleans unknown tools, never showing a raw name', () => {
    expect(stepWords('mcp__office__some_new_tool').text).toBe('Some new tool');
    expect(stepWords('MysteryTool').text).toBe('Using mystery tool');
  });

  it('masks secrets and keeps sentences short', () => {
    expect(stepWords('Bash', '⏺ $ GH_TOKEN=ghp_abcdefghijklmnopqrstuvwx gh pr list').text).not.toMatch(/ghp_/);
    expect(stepWords('Read', `⏺ Read ${'a/'.repeat(80)}x.ts`).text.length).toBeLessThanOrEqual(90);
    expect(stepNote('  ⎿ token sk-abcdefghijklmnopqrstu failed\nmore')).toBe('token ••• failed');
  });

  it('reads a filed issue back as "Filed floor 3 #149"', () => {
    expect(filedWords('Filed #149 on floor 3: Joystick.', null)).toBe('Filed floor 3 #149');
    expect(filedWords('Filed #149', 2)).toBe('Filed floor 2 #149');
    expect(filedWords('Refused: no', 2)).toBeNull();
  });

  it('says how long a step took', () => {
    expect(shortDuration(800)).toBe('0.8 s');
    expect(shortDuration(42_400)).toBe('42 s');
    expect(shortDuration(150_000)).toBe('2 min');
    expect(shortDuration(65 * 60_000)).toBe('1 h 5 min');
  });
});
