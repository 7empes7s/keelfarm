import { describe, expect, it } from 'vitest';
import { BACKGROUND_KINDS, ceoDigest, ceoJobSession, DIGEST_MAX, freshStart, handoverOf, jobNote, loadHandover, sinceLastChat, splitFreshStart, type DigestInput } from './ceoDigest.ts';
import type { CeoJobKind, PhoneMessage } from '../shared/types.ts';
import type { Decision } from '../shared/decisions.ts';

const msg = (id: number, from: PhoneMessage['from'], text: string, extra: Partial<PhoneMessage> = {}): PhoneMessage => ({ id, from, text, at: id, ...extra });
const input = (over: Partial<DigestInput> = {}): DigestInput => ({ messages: [], decisions: [], mandates: [], remember: [], lastJob: null, now: 1_000, ...over });

describe('which CEO jobs carry on in the chat session', () => {
  const kept = { resume: true, why: null };
  const full = { resume: false, why: 'its session took 300 turns, so its context is full' };
  it('starts background jobs fresh, and only chat carries on', () => {
    for (const kind of ['review', 'followup', 'triage', 'research', 'plan'] as CeoJobKind[]) expect(ceoJobSession(kind, { freshJobs: true }, kept)).toEqual({ fresh: true, resume: false, why: null });
    expect(ceoJobSession('chat', { freshJobs: true }, kept)).toEqual({ fresh: false, resume: true, why: null });
    expect(ceoJobSession('chat', { freshJobs: true }, { resume: false, why: null })).toMatchObject({ resume: true }); // keep-alive off: a chat still carries on
    expect(ceoJobSession('chat', { freshJobs: true }, full)).toEqual({ fresh: false, ...full });
    expect(ceoJobSession('onboard', { freshJobs: true }, kept)).toMatchObject({ fresh: false, resume: true });
  });

  it('lets every job carry on as before with the setting off', () => {
    expect(ceoJobSession('review', { freshJobs: false }, kept)).toEqual({ fresh: false, resume: true, why: null });
    expect(ceoJobSession('followup', { freshJobs: false }, { resume: false, why: null })).toEqual({ fresh: false, resume: false, why: null });
    expect(BACKGROUND_KINDS).not.toContain('chat');
  });
});

describe("the office's digest for a fresh session", () => {
  const decision = { id: 'd1', status: 'open', question: 'Ship dark mode first?', snoozedUntil: null, lastAskedAt: 900 } as unknown as Decision;
  it('holds the recent chat, open decisions, mandates, notes, the last reply’s issues and the latest background job', () => {
    const d = ceoDigest(
      input({
        messages: [
          msg(1, 'manager', 'Plan the pocket mode work'),
          msg(2, 'office', 'Ada joined floor 1'),
          msg(3, 'ceo', `Filed two issues. ${'x'.repeat(500)}`, { actions: [{ tool: 'file_issue', icon: '📝', text: 'Filed floor 1 #41 · Pocket chat' }, { tool: 'file_issue', icon: '📝', text: 'Refused: cap', refused: true }] }),
          msg(4, 'manager', 'Thanks'),
        ],
        decisions: [decision],
        mandates: [{ id: 'm1', text: 'Keep floor 2 lean', floors: [2], expiresAt: null, at: 1 }],
        remember: [{ id: 'n1', text: 'The manager reads on an iPhone', at: 1 }],
        lastJob: jobNote('review', 'Company review', 'Grew floor 1 to 3 agents.', { actions: [{ tool: 'file_issue', icon: '📝', text: 'Filed floor 1 #42 · Tests' }] }, 950),
      }),
    );
    expect(d).toContain('- Manager: Plan the pocket mode work\n  You: Filed two issues.');
    expect(d).not.toContain('x'.repeat(300)); // a reply's first ~300 characters
    expect(d).not.toContain('Ada joined');
    expect(d).toContain('- Manager: Thanks');
    expect(d).toContain('- d1: Ship dark mode first?');
    expect(d).toContain('- Keep floor 2 lean (floor 2)');
    expect(d).toContain('- The manager reads on an iPhone');
    expect(d).toContain('Issues your last chat reply filed:\n- Filed floor 1 #41 · Pocket chat');
    expect(d).not.toContain('Refused');
    expect(d).toContain('Your latest background job (Company review):\nGrew floor 1 to 3 agents.\n- Filed floor 1 #42 · Tests');
  });

  it('keeps the last 10 exchanges and stays under its cap, dropping the oldest first', () => {
    const many = Array.from({ length: 30 }, (_, i) => [msg(2 * i, 'manager', `question ${i} ${'q'.repeat(400)}`), msg(2 * i + 1, 'ceo', `answer ${i} ${'a'.repeat(400)}`)]).flat();
    const d = ceoDigest(input({ messages: many }));
    expect(d).not.toContain('question 19 ');
    expect(d).toContain('question 29 ');
    expect(d.length).toBeLessThanOrEqual(DIGEST_MAX);
    const huge = ceoDigest(input({ messages: many, remember: Array.from({ length: 40 }, (_, i) => ({ id: `n${i}`, text: `note ${i} ${'n'.repeat(290)}`, at: 1 })) }));
    expect(huge.length).toBeLessThanOrEqual(DIGEST_MAX);
    expect(huge).toContain('note 0'); // the chat gave way first
  });

  it('tells a resumed chat what a background job did since it last ran', () => {
    const note = jobNote('review', 'Company review', 'Filed one issue.', { actions: [{ tool: 'file_issue', icon: '📝', text: 'Filed floor 1 #42 · Tests' }] }, 500);
    expect(sinceLastChat(note, 400)).toContain('Company review');
    expect(sinceLastChat(note, 400)).toContain('#42');
    expect(sinceLastChat(note, 600)).toBe('');
    expect(sinceLastChat(null, 0)).toBe('');
  });
});

describe('the handover between chat sessions', () => {
  it('starts the next session with the handover when there is one, else the digest alone', () => {
    const h = handoverOf('PR #12 waits for QA; I promised the manager a summary.', 5)!;
    expect(freshStart('DIGEST', h)).toMatch(/^Handover from your previous session:\nPR #12 waits for QA; I promised the manager a summary\.\n\nDIGEST/);
    expect(freshStart('DIGEST', null)).toMatch(/^DIGEST\n/);
    const p = `${freshStart('Digest from the office: …', h)}Periodic review of the company.`;
    expect(splitFreshStart(p)).toEqual({ start: expect.stringContaining('PR #12 waits'), job: 'Periodic review of the company.' });
    expect(splitFreshStart('Periodic review')).toEqual({ start: '', job: 'Periodic review' });
    expect(handoverOf('   ', 5)).toBeNull();
    expect(handoverOf('word '.repeat(600), 5)!.text.split(/\s+/).length).toBeLessThanOrEqual(401);
  });

  it('survives the office restart: saved in state.json and loaded back', () => {
    const h = handoverOf('In flight: #41.', 7);
    expect(loadHandover(JSON.parse(JSON.stringify({ handover: h })).handover)).toEqual({ text: 'In flight: #41.', at: 7 });
    expect(loadHandover(undefined)).toBeNull();
    expect(loadHandover({ text: '', at: 1 })).toBeNull();
  });
});
