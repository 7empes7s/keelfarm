import { describe, expect, it } from 'vitest';
import { askerName, briefSummary, chatOrigin, jobName, researchInterim, senderLook, takeResearchCard, updateResearchCard } from './chatSender.ts';
import type { PhoneMessage } from './types.ts';

const msg = (id: number, o: Partial<PhoneMessage> = {}): PhoneMessage => ({ id, from: 'ceo', text: 'hi', at: id, ...o });
const names = { ceo: 'Mimoun', researcher: 'Sage', it: 'Iris' };

describe('chatOrigin', () => {
  it('gives every chat item its sender by origin', () => {
    expect(chatOrigin(msg(1))).toBe('ceo');
    expect(chatOrigin(msg(1, { from: 'manager' }))).toBe('manager');
    expect(chatOrigin(msg(1, { research: { topic: 'x', job: 1, state: 'running' } }))).toBe('research');
    expect(chatOrigin(msg(1, { from: 'office', research: { topic: 'x', job: 1, state: 'queued' } }))).toBe('research');
    expect(chatOrigin(msg(1, { from: 'office', origin: 'it' }))).toBe('it');
    expect(chatOrigin(msg(1, { background: 'Reviewing the company' }))).toBe('job');
    expect(chatOrigin(msg(1, { ceoJob: { job: 3, kind: 'followup', model: 'm' } }))).toBe('job');
    expect(chatOrigin(msg(1, { ceoJob: { job: 3, kind: 'chat', model: 'm' } }))).toBe('ceo');
    expect(chatOrigin(msg(1, { question: 'q1' }))).toBe('agent');
    expect(chatOrigin(msg(1, { from: 'office' }))).toBe('event');
  });

  it("names each origin apart from the CEO's own bubble", () => {
    expect(senderLook('research', names)).toMatchObject({ name: 'Sage', role: 'Research' });
    expect(senderLook('it', names)).toMatchObject({ name: 'Iris', role: 'IT' });
    expect(senderLook('job', names)).toMatchObject({ name: 'Mimoun', role: 'background' });
    expect(senderLook('agent', { ...names, agent: askerName('❓ Ada asks (floor 2 #13): which port?') })).toMatchObject({ name: 'Ada', role: 'asks' });
    expect(senderLook('ceo', names).role).toBeNull();
    expect(jobName({ ceoJob: { job: 1, kind: 'review', model: 'm' } })).toBe('Reviewing the company');
    expect(jobName({ background: 'Following up on #12 merged' })).toBe('Following up on #12 merged');
  });
});

describe('research cards', () => {
  it('an interim status updates the existing card instead of appending', () => {
    const messages = [msg(1, { from: 'office', text: 'queued', research: { topic: 'SOC 2', job: 7, state: 'queued' } }), msg(2)];
    const m = updateResearchCard(messages, 7, { text: 'running', research: { topic: 'SOC 2', job: 7, state: 'running', startedAt: 5 } });
    expect(m?.id).toBe(1);
    expect(messages).toHaveLength(2);
    expect(messages[0]).toMatchObject({ text: 'running', research: { state: 'running', startedAt: 5 } });
    expect(updateResearchCard(messages, 8, { research: { topic: 'other', job: 8, state: 'running' } })).toBeNull();
  });

  it('the brief takes the interim card out, leaving one card per job', () => {
    const messages = [msg(1, { from: 'office', research: { topic: 'SOC 2', job: 7, state: 'running' } }), msg(2), msg(3, { research: { topic: 'old', job: 6, state: 'done' } })];
    expect(takeResearchCard(messages, 7)?.id).toBe(1);
    expect(messages.map((m) => m.id)).toEqual([2, 3]);
    expect(takeResearchCard(messages, 6)).toBeNull(); // a brief stays
  });

  it('interim cards are never read aloud; briefs from before #679 are done', () => {
    expect(researchInterim({ topic: 'x', state: 'running' })).toBe(true);
    expect(researchInterim({ topic: 'x', state: 'queued' })).toBe(true);
    expect(researchInterim({ topic: 'x', state: 'done' })).toBe(false);
    expect(researchInterim({ topic: 'x' })).toBe(false);
    expect(briefSummary('🔎 Sage\'s research on "x" · 3 min · $1.00\n\nThe gist.')).toBe('The gist.');
  });
});
