import { describe, expect, it } from 'vitest';
import { designAnswer, designDecision, optionLetter } from './designs.ts';
import { onManagerMessage, syncDecisions, waitingDecisions } from './decisions.ts';
import type { FileRef } from './files.ts';
import type { PhoneMessage } from './types.ts';

const shot = (id: string): FileRef => ({ id, name: `${id}.png`, type: 'image/png', size: 10, from: 'ceo', at: 0, keep: false });
const proposal = { floor: 1, title: 'Todo cards', question: 'Which look should ship?', issue: 7, repoId: 'r1', options: [{ label: 'Flat rows', shots: [shot('a')], previewUrl: null }, { label: 'Raised cards', shots: [shot('b')], previewUrl: 'https://example.com/b' }] };

describe('design proposals (#209)', () => {
  it('opens a design decision tied to the message that presented it', () => {
    const d = designDecision(proposal, 42, 1000);
    expect(d).toMatchObject({ id: 'design:42', kind: 'design', question: 'Which look should ship?', options: ['Flat rows', 'Raised cards'], repoIds: ['r1'], about: [{ kind: 'issue', repoId: 'r1', number: 7 }], messageId: 42, status: 'open' });
    expect(d.design?.options[1].shots[0].id).toBe('b');
    expect(waitingDecisions([d], 2000)).toEqual([d]);
  });

  it("stays open through the office's syncs: nothing seeds it", () => {
    const d = designDecision(proposal, 42, 1000);
    expect(syncDecisions([d], { seeds: [], gone: () => true }, 2000)).toEqual([d]);
  });

  it("the manager's pick goes back as a reply, which closes it with that answer", () => {
    const d = designDecision(proposal, 42, 1000);
    const text = designAnswer(d, 1, ' Ship it with the dark shadow. ');
    expect(text).toBe('Design “Todo cards”: I pick B, Raised cards. Ship it with the dark shadow.');
    const reply: PhoneMessage = { id: 43, from: 'manager', text, at: 3000, replyTo: 42 };
    const [closed] = onManagerMessage([d], reply, 3000);
    expect(closed).toMatchObject({ status: 'resolved', closedAt: 3000 });
    expect(closed.outcome).toContain('I pick B, Raised cards');
  });

  it('asks for changes instead of a pick', () => {
    expect(designAnswer(designDecision(proposal, 1, 0), 'changes')).toBe('Design “Todo cards”: none yet, please change it.');
    expect(optionLetter(2)).toBe('C');
  });
});
