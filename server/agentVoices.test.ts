import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';

// A voice for every agent (#320) in a demo office: its own folder, as voiceKey.test.ts, for the demo secrets file.
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'cubefarm-agentvoices-'));
process.env.SWARM_HOME = home;
const { createDemoBackend } = await import('./demo.ts');
const { Swarm } = await import('./swarm.ts');
afterAll(() => fs.rmSync(home, { recursive: true, force: true, maxRetries: 5 }));

describe("agents' voices", () => {
  it('gives every agent a distinct voice once ElevenLabs speaks, new hires too; the manager can change or clear one', async () => {
    const swarm = new Swarm(createDemoBackend());
    const repo = await swarm.connectRepo('demo-co/pixel-todo');
    swarm.hireAgent(repo.id, { name: 'Bo' });
    const team = () => swarm.snapshot().agents.filter((a) => a.repoId === repo.id);
    expect(team().every((a) => a.voiceId === '')).toBe(true); // ElevenLabs off: nobody has a voice

    await swarm.voice.setKey('sk_demo_key_1234');
    swarm.updateSettings({ voice: { ...swarm.snapshot().settings.voice, provider: 'elevenlabs' } });
    await vi.waitFor(() => expect(team().every((a) => a.voiceId)).toBe(true));
    const cy = swarm.hireAgent(repo.id, { name: 'Cy' });
    await vi.waitFor(() => expect(team().find((a) => a.id === cy.id)?.voiceId).toBeTruthy());
    const ids = team().map((a) => a.voiceId);
    expect(new Set(ids).size).toBe(ids.length);
    expect(team().every((a) => a.voiceName)).toBe(true);

    swarm.updateAgent(cy.id, { voiceId: 'demoVoiceBasil00002', voiceName: 'Basil' });
    expect(team().find((a) => a.id === cy.id)).toMatchObject({ voiceId: 'demoVoiceBasil00002', voiceName: 'Basil' });
    expect(() => swarm.updateAgent(cy.id, { voiceId: 'not a voice' })).toThrow(/voice id/);
    swarm.updateAgent(cy.id, { voiceId: '' });
    expect(team().find((a) => a.id === cy.id)).toMatchObject({ voiceId: '', voiceName: '' });
  });
});
