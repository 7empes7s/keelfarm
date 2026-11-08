import { describe, expect, it } from 'vitest';
import type { PhoneMessage } from '../shared/types.ts';
import { ceoSystemPrompt } from './ceo.ts';
import { createDemoBackend } from './demo.ts';
import { withSpoken } from './demo/ceo.ts';
import { Swarm } from './swarm.ts';
import { DEFAULT_VOICE } from './voice.ts';

// The CEO's spoken summary (#282): asked for in its prompt, lifted out of its final message and kept on the message.
type Internals = { ensureCeo(interrupted: unknown[]): void; postMessage(from: PhoneMessage['from'], text: string, requestId?: string, opts?: { replyTo?: number }): PhoneMessage; postCeoReply(raw: string): void; ceoReply(x: { message_id: number; text: string }): string; ceo(): { startedAt: number | null }; state: { messages: PhoneMessage[] } };

describe('the spoken summary', () => {
  it('the CEO prompt asks for a short ```spoken block without numbers, links or filler', () => {
    const system = ceoSystemPrompt({ name: 'Luna', company: 'Acme', manager: 'Sam', notesFile: 'notes.md', sessionLimit: 0, maxAgents: 10, scaling: 'approve' });
    expect(system).toContain('End it, and each reply, with a ```spoken block: 1-3 sentences (under 300 characters)');
    expect(system).toContain('No issue numbers, links, markdown or filler ("I answered your message").');
  });

  it("a CEO reply's spoken line is stored on its message and in the snapshot", () => {
    const swarm = new Swarm(createDemoBackend());
    const internals = swarm as unknown as Internals;
    internals.ensureCeo([]);
    const m = internals.postMessage('ceo', 'I filed #278 and #279.\n\n```spoken\nI filed two fixes for the terminal.\n```');
    expect(m).toMatchObject({ text: 'I filed #278 and #279.', spoken: 'I filed two fixes for the terminal.' });
    expect(swarm.snapshot().messages.find((x) => x.id === m.id)?.spoken).toBe('I filed two fixes for the terminal.');
  });

  it("after answering with the reply tool, the turn's bookkeeping close is not read aloud", () => {
    const swarm = new Swarm(createDemoBackend());
    swarm.updateSettings({ voice: { ...DEFAULT_VOICE, provider: 'browser' } });
    const internals = swarm as unknown as Internals;
    internals.ensureCeo([]);
    internals.ceo().startedAt = Date.now() - 1000; // a job is running
    const asked = internals.postMessage('manager', 'How is the terminal?');
    internals.postCeoReply('Floor 1 is busy.'); // a closing text before any reply is read as usual
    expect(internals.state.messages.at(-1)).toMatchObject({ text: 'Floor 1 is busy.', voice: 'browser' });
    internals.ceoReply({ message_id: asked.id, text: 'Paste works now.\n```spoken\nPaste works on your phone now.\n```' });
    const answer = internals.state.messages.at(-1)!;
    expect(answer).toMatchObject({ spoken: 'Paste works on your phone now.', voice: 'browser' });
    internals.postCeoReply('Both messages are answered on your phone.');
    const close = internals.state.messages.at(-1)!;
    expect(close).toMatchObject({ from: 'ceo', text: 'Both messages are answered on your phone.', silent: true });
    expect(close.voice).toBeUndefined();
  });

  it("the demo CEO's replies carry one", () => {
    expect(withSpoken('All floors look healthy: 3 open issues. No changes needed. Bye.')).toBe('All floors look healthy: 3 open issues. No changes needed. Bye.\n\n```spoken\nAll floors look healthy: 3 open issues. No changes needed.\n```');
    const own = 'Hi.\n```spoken\nHello there.\n```';
    expect(withSpoken(own)).toBe(own);
  });
});
